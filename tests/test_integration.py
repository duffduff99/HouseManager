"""End-to-end tests against a real (test) Home Assistant instance."""

from datetime import timedelta

import aiohttp
from freezegun.api import FrozenDateTimeFactory
from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util
import pytest
from pytest_homeassistant_custom_component.common import (
    async_fire_time_changed,
    async_mock_service,
)

TODO = "todo.house_maintenance"
SENSOR = "sensor.house_maintenance_open_tasks"


@pytest.fixture(autouse=True)
async def central_time(hass):
    await hass.config.async_set_time_zone("America/Chicago")


@pytest.fixture
async def ws(hass, hass_ws_client, setup_integration):
    client = await hass_ws_client(hass)

    async def call(type_: str, **kwargs):
        await client.send_json_auto_id({"type": f"house_manager/{type_}", **kwargs})
        msg = await client.receive_json()
        assert msg["success"], msg
        return msg["result"]

    return call


async def tick(hass: HomeAssistant, freezer: FrozenDateTimeFactory, delta: timedelta) -> None:
    freezer.tick(delta)
    async_fire_time_changed(hass)
    await hass.async_block_till_done()


async def test_setup_creates_entities(hass, setup_integration):
    assert hass.states.get(TODO) is not None
    assert hass.states.get(SENSOR).state == "0"
    assert "house-manager" in hass.data["frontend_panels"]


async def test_assets_locations_and_categories(hass, ws):
    asset = await ws(
        "asset/save",
        name="Water Softener",
        category_name="Laundry and Mechanical",
        location_path="Basement > Mechanical Room",
        model_number="WS-100",
        purchase_price=899.99,
    )
    data = await ws("get_data")
    locations = {loc["id"]: loc for loc in data["locations"]}
    room = locations[asset["location_id"]]
    assert room["name"] == "Mechanical Room"
    assert locations[room["parent_id"]]["name"] == "Basement"
    # Re-using a path does not create duplicates.
    await ws("asset/save", name="Furnace", location_path="basement > mechanical room")
    assert len((await ws("get_data"))["locations"]) == 2

    # Retire, then delete the parent location: asset moves up.
    await ws("asset/save", item_id=asset["id"], retired_date="2026-11-02")
    await ws("location/delete", item_id=room["id"])
    data = await ws("get_data")
    saved = next(a for a in data["assets"] if a["id"] == asset["id"])
    assert saved["retired_date"] == "2026-11-02"
    assert locations[saved["location_id"]]["name"] == "Basement"


async def test_weekly_task_lifecycle(hass, ws, setup_integration, freezer):
    manager = setup_integration
    # Monday 2026-11-02 10:00 local time
    freezer.move_to(dt_util.parse_datetime("2026-11-02T10:00:00-06:00"))
    asset = await ws("asset/save", name="Bird Feeder")
    task = await ws(
        "task/save",
        title="Fill bird food",
        asset_id=asset["id"],
        schedule={"type": "weekly", "weekdays": [4]},
    )
    assert task["status"] == "done"
    assert hass.states.get(SENSOR).state == "0"

    # Friday: it appears.
    await tick(hass, freezer, timedelta(days=4))
    assert hass.states.get(SENSOR).state == "1"

    # Not done by the next Friday: replaced, and the old one is logged as missed.
    await tick(hass, freezer, timedelta(days=7))
    assert hass.states.get(SENSOR).state == "1"
    # (The websocket test client's token has expired after time travel, so
    # read straight from the manager from here on.)
    history = manager.history_for(asset_id=asset["id"])
    assert [h["result"] for h in history] == ["missed"]

    # Check it off on the HA to-do list.
    await hass.services.async_call(
        "todo",
        "update_item",
        {"item": "Fill bird food", "status": "completed"},
        target={"entity_id": TODO},
        blocking=True,
    )
    assert hass.states.get(SENSOR).state == "0"
    history = manager.history_for(task_id=task["id"])
    assert [h["result"] for h in history] == ["missed", "completed"]

    # Un-check it again: reopened and the completion is removed.
    await hass.services.async_call(
        "todo",
        "update_item",
        {"item": "Fill bird food", "status": "needs_action"},
        target={"entity_id": TODO},
        blocking=True,
    )
    assert hass.states.get(SENSOR).state == "1"
    assert [h["result"] for h in manager.history_for(task_id=task["id"])] == ["missed"]


async def test_task_due_today_opens_immediately(hass, ws, freezer):
    freezer.move_to(dt_util.parse_datetime("2026-11-06T15:00:00-06:00"))  # a Friday
    await ws("task/save", title="Vacuum", schedule={"type": "weekly", "weekdays": [4]})
    assert hass.states.get(SENSOR).state == "1"


async def test_add_item_on_todo_list_creates_one_time_task(hass, ws):
    await hass.services.async_call(
        "todo", "add_item", {"item": "Fix squeaky door"}, target={"entity_id": TODO}, blocking=True
    )
    data = await ws("get_data")
    (task,) = data["tasks"]
    assert task["schedule"]["type"] == "once"
    assert task["status"] == "open"

    await ws("task/complete", item_id=task["id"])
    data = await ws("get_data")
    assert data["tasks"][0]["status"] == "done"
    assert data["tasks"][0]["next_due"] is None


async def test_daily_digest(hass, ws, freezer):
    freezer.move_to(dt_util.parse_datetime("2026-11-06T06:00:00-06:00"))
    calls = async_mock_service(hass, "notify", "mobile_app_phone")
    await ws("settings/save", notify_services=["mobile_app_phone"], digest_time="07:00")
    await ws("task/save", title="Clean bathroom", schedule={"type": "weekly", "weekdays": [4]})
    await ws("task/save", title="Water plants", schedule={"type": "weekly", "weekdays": [4]})

    await tick(hass, freezer, timedelta(minutes=59))
    assert len(calls) == 0
    await tick(hass, freezer, timedelta(minutes=1))
    assert len(calls) == 1
    assert calls[0].data["title"] == "2 new household tasks"
    assert "Clean bathroom" in calls[0].data["message"]

    # Next day: nothing new, so no notification (digest_only_new is on).
    await tick(hass, freezer, timedelta(days=1))
    assert len(calls) == 1


async def test_upload_and_download(hass, ws, hass_client):
    asset = await ws("asset/save", name="Oven")
    client = await hass_client()
    form = aiohttp.FormData()
    form.add_field("file", b"%PDF-1.4 test", filename="manual.pdf", content_type="application/pdf")
    resp = await client.post(
        f"/api/house_manager/upload?owner_type=asset&owner_id={asset['id']}", data=form
    )
    assert resp.status == 200, await resp.text()
    attachment = await resp.json()
    assert attachment["filename"] == "manual.pdf"

    resp = await client.get(f"/api/house_manager/file/{attachment['id']}")
    assert resp.status == 200
    assert await resp.read() == b"%PDF-1.4 test"
    assert resp.headers["Content-Type"] == "application/pdf"

    await ws("asset/delete", item_id=asset["id"])
    resp = await client.get(f"/api/house_manager/file/{attachment['id']}")
    assert resp.status == 404


async def test_bad_schedule_is_rejected(hass, hass_ws_client, setup_integration):
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {
            "type": "house_manager/task/save",
            "title": "x",
            "schedule": {"type": "cron", "expression": "bad"},
        }
    )
    msg = await client.receive_json()
    assert not msg["success"]
    assert "5 fields" in msg["error"]["message"]


async def test_data_survives_restart(hass, ws, setup_integration):
    await ws("asset/save", name="TV")
    entry = hass.config_entries.async_entries("house_manager")[0]
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    data = await ws("get_data")
    assert [a["name"] for a in data["assets"]] == ["TV"]


async def test_schedule_preview(hass, ws, freezer):
    freezer.move_to(dt_util.parse_datetime("2026-11-02T10:00:00-06:00"))
    result = await ws("schedule/preview", schedule={"type": "yearly", "dates": ["10-01", "04-01"]})
    assert result["schedule"]["dates"] == ["04-01", "10-01"]
    assert [d[:10] for d in result["next"]] == ["2027-04-01", "2027-10-01", "2028-04-01"]
