"""Websocket API used by the House Manager panel."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.util import dt as dt_util
import voluptuous as vol

from .const import DOMAIN, SIGNAL_UPDATED
from .manager import HouseManagerError
from .schedule import next_occurrence, normalize

OPTIONAL_STR = vol.Any(None, str)
OPTIONAL_NUMBER = vol.Any(None, vol.Coerce(float))


def _manager(hass: HomeAssistant):
    return hass.data.get(DOMAIN)


def _command(schema: dict):
    """Decorator: register a websocket command with error handling.

    The wrapped function receives (hass, connection, msg) and returns the
    result to send back (may be a coroutine).
    """

    def decorator(func):
        @websocket_api.websocket_command(schema)
        @websocket_api.async_response
        async def handler(hass, connection, msg):
            manager = _manager(hass)
            if manager is None:
                connection.send_error(msg["id"], "not_loaded", "House Manager is not set up")
                return
            try:
                result = func(manager, connection, msg)
                if hasattr(result, "__await__"):
                    result = await result
            except HouseManagerError as err:
                connection.send_error(msg["id"], "invalid", str(err))
                return
            connection.send_result(msg["id"], result)

        handler.__name__ = func.__name__
        return handler

    return decorator


def _fields(msg: dict, *, drop: tuple[str, ...] = ("id", "type")) -> dict[str, Any]:
    """Copy the message minus the websocket envelope keys."""
    data = {k: v for k, v in msg.items() if k not in drop}
    if "item_id" in data:
        data["id"] = data.pop("item_id")
    return data


@_command({vol.Required("type"): "house_manager/get_data"})
def ws_get_data(manager, connection, msg):
    return manager.async_snapshot()


@_command(
    {
        vol.Required("type"): "house_manager/history",
        vol.Optional("asset_id"): str,
        vol.Optional("task_id"): str,
    }
)
def ws_history(manager, connection, msg):
    return manager.history_for(msg.get("asset_id"), msg.get("task_id"))


@websocket_api.websocket_command({vol.Required("type"): "house_manager/subscribe"})
@callback
def ws_subscribe(hass, connection, msg):
    """Tell the panel whenever data changes so it can refresh."""

    @callback
    def forward() -> None:
        connection.send_message(websocket_api.event_message(msg["id"], {"updated": True}))

    connection.subscriptions[msg["id"]] = async_dispatcher_connect(hass, SIGNAL_UPDATED, forward)
    connection.send_result(msg["id"])


@_command({vol.Required("type"): "house_manager/schedule/preview", vol.Required("schedule"): dict})
def ws_schedule_preview(manager, connection, msg):
    """Validate a schedule and return its next few occurrences."""
    try:
        schedule = normalize(msg["schedule"])
    except ValueError as err:
        raise HouseManagerError(str(err)) from err
    result, after = [], dt_util.start_of_local_day() - timedelta(seconds=1)
    while len(result) < 3 and (after := next_occurrence(schedule, after)):
        result.append(after.isoformat())
    return {"schedule": schedule, "next": result}


# --- Tasks -------------------------------------------------------------------

TASK_FIELDS = {
    vol.Optional("item_id"): str,
    vol.Optional("title"): vol.All(str, vol.Length(min=1)),
    vol.Optional("notes"): str,
    vol.Optional("asset_id"): OPTIONAL_STR,
    vol.Optional("assignee"): OPTIONAL_STR,
    vol.Optional("schedule"): dict,
    vol.Optional("enabled"): bool,
    vol.Optional("open_now"): bool,
}


@_command({vol.Required("type"): "house_manager/task/save", **TASK_FIELDS})
def ws_task_save(manager, connection, msg):
    data = _fields(msg)
    if not data.get("id") and not data.get("title"):
        raise HouseManagerError("Title is required")
    return manager.save_task(data)


@_command({vol.Required("type"): "house_manager/task/delete", vol.Required("item_id"): str})
def ws_task_delete(manager, connection, msg):
    manager.delete_task(msg["item_id"])


@_command({vol.Required("type"): "house_manager/task/complete", vol.Required("item_id"): str})
def ws_task_complete(manager, connection, msg):
    return manager.complete_task(msg["item_id"], connection.user.id)


@_command({vol.Required("type"): "house_manager/task/skip", vol.Required("item_id"): str})
def ws_task_skip(manager, connection, msg):
    return manager.skip_task(msg["item_id"], connection.user.id)


@_command({vol.Required("type"): "house_manager/task/reopen", vol.Required("item_id"): str})
def ws_task_reopen(manager, connection, msg):
    return manager.reopen_task(msg["item_id"])


# --- Assets ------------------------------------------------------------------

ASSET_SCHEMA = {
    vol.Optional("item_id"): str,
    vol.Optional("name"): str,
    vol.Optional("category_id"): OPTIONAL_STR,
    vol.Optional("category_name"): OPTIONAL_STR,
    vol.Optional("location_id"): OPTIONAL_STR,
    vol.Optional("location_path"): OPTIONAL_STR,
    vol.Optional("manufacturer"): OPTIONAL_STR,
    vol.Optional("model_number"): OPTIONAL_STR,
    vol.Optional("serial_number"): OPTIONAL_STR,
    vol.Optional("description"): OPTIONAL_STR,
    vol.Optional("purchase_date"): OPTIONAL_STR,
    vol.Optional("purchase_price"): OPTIONAL_NUMBER,
    vol.Optional("replacement_value"): OPTIONAL_NUMBER,
    vol.Optional("retired_date"): OPTIONAL_STR,
}


@_command({vol.Required("type"): "house_manager/asset/save", **ASSET_SCHEMA})
def ws_asset_save(manager, connection, msg):
    return manager.save_asset(_fields(msg))


@_command({vol.Required("type"): "house_manager/asset/delete", vol.Required("item_id"): str})
def ws_asset_delete(manager, connection, msg):
    return manager.async_delete_asset(msg["item_id"])


@_command(
    {
        vol.Required("type"): "house_manager/asset/import",
        vol.Required("rows"): [
            vol.Schema({k: v for k, v in ASSET_SCHEMA.items() if str(k) != "item_id"})
        ],
    }
)
def ws_asset_import(manager, connection, msg):
    return {"imported": manager.import_assets(msg["rows"])}


# --- Maintenance records -----------------------------------------------------


@_command(
    {
        vol.Required("type"): "house_manager/record/save",
        vol.Optional("item_id"): str,
        vol.Optional("asset_id"): str,
        vol.Optional("date"): str,
        vol.Optional("notes"): str,
    }
)
def ws_record_save(manager, connection, msg):
    data = _fields(msg)
    if not data.get("id") and not data.get("asset_id"):
        raise HouseManagerError("asset_id is required")
    return manager.save_record(data)


@_command({vol.Required("type"): "house_manager/record/delete", vol.Required("item_id"): str})
def ws_record_delete(manager, connection, msg):
    return manager.async_delete_record(msg["item_id"])


@_command({vol.Required("type"): "house_manager/attachment/delete", vol.Required("item_id"): str})
def ws_attachment_delete(manager, connection, msg):
    return manager.async_delete_attachment(msg["item_id"])


# --- Categories, locations, settings -----------------------------------------


@_command(
    {
        vol.Required("type"): "house_manager/category/save",
        vol.Optional("item_id"): str,
        vol.Required("name"): str,
    }
)
def ws_category_save(manager, connection, msg):
    return manager.save_category(_fields(msg))


@_command({vol.Required("type"): "house_manager/category/delete", vol.Required("item_id"): str})
def ws_category_delete(manager, connection, msg):
    manager.delete_category(msg["item_id"])


@_command(
    {
        vol.Required("type"): "house_manager/location/save",
        vol.Optional("item_id"): str,
        vol.Required("name"): str,
        vol.Optional("parent_id"): OPTIONAL_STR,
    }
)
def ws_location_save(manager, connection, msg):
    return manager.save_location(_fields(msg))


@_command({vol.Required("type"): "house_manager/location/delete", vol.Required("item_id"): str})
def ws_location_delete(manager, connection, msg):
    manager.delete_location(msg["item_id"])


@_command(
    {
        vol.Required("type"): "house_manager/settings/save",
        vol.Optional("digest_enabled"): bool,
        vol.Optional("digest_time"): str,
        vol.Optional("digest_only_new"): bool,
        vol.Optional("notify_services"): [str],
        vol.Optional("people"): {
            str: {
                vol.Required("notify_services"): [str],
                vol.Optional("include_unassigned", default=True): bool,
            }
        },
    }
)
def ws_settings_save(manager, connection, msg):
    return manager.save_settings(_fields(msg))


@_command({vol.Required("type"): "house_manager/send_digest"})
def ws_send_digest(manager, connection, msg):
    async def run():
        return {"sent": await manager.async_send_digest(force=True)}  # notifications sent

    return run()


@callback
def async_register(hass: HomeAssistant) -> None:
    for handler in (
        ws_get_data,
        ws_history,
        ws_subscribe,
        ws_schedule_preview,
        ws_task_save,
        ws_task_delete,
        ws_task_complete,
        ws_task_skip,
        ws_task_reopen,
        ws_asset_save,
        ws_asset_delete,
        ws_asset_import,
        ws_record_save,
        ws_record_delete,
        ws_attachment_delete,
        ws_category_save,
        ws_category_delete,
        ws_location_save,
        ws_location_delete,
        ws_settings_save,
        ws_send_digest,
    ):
        websocket_api.async_register_command(hass, handler)
