"""House Manager: household maintenance tasks and asset inventory for Home Assistant."""

from __future__ import annotations

from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType
from homeassistant.util import dt as dt_util
import voluptuous as vol

from . import http, websocket
from .const import (
    DOMAIN,
    PANEL_ELEMENT,
    PANEL_ICON,
    PANEL_TITLE,
    PANEL_URL_PATH,
    STATIC_URL,
    VERSION,
)
from .manager import HouseManager, HouseManagerError

PLATFORMS = [Platform.SENSOR, Platform.TODO]
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

type HouseManagerConfigEntry = ConfigEntry[HouseManager]


def get_manager(hass: HomeAssistant) -> HouseManager:
    manager = hass.data.get(DOMAIN)
    if manager is None:
        raise HomeAssistantError("House Manager is not set up")
    return manager


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register things that only need registering once per HA start."""
    websocket.async_register(hass)
    http.async_register(hass)
    await hass.http.async_register_static_paths(
        [StaticPathConfig(STATIC_URL, str(Path(__file__).parent / "frontend"), False)]
    )
    _register_services(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: HouseManagerConfigEntry) -> bool:
    manager = HouseManager(hass)
    await manager.async_load()
    hass.data[DOMAIN] = manager
    entry.runtime_data = manager

    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_URL_PATH,
        webcomponent_name=PANEL_ELEMENT,
        module_url=f"{STATIC_URL}/house-manager-panel.js?v={VERSION}",
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        require_admin=False,
        config={},
    )
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    await manager.async_start()
    return True


async def async_unload_entry(hass: HomeAssistant, entry: HouseManagerConfigEntry) -> bool:
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        frontend.async_remove_panel(hass, PANEL_URL_PATH)
        await entry.runtime_data.async_stop()
        hass.data.pop(DOMAIN, None)
    return unloaded


def _register_services(hass: HomeAssistant) -> None:
    async def complete_task(call: ServiceCall) -> None:
        try:
            get_manager(hass).complete_task(call.data["task_id"], call.context.user_id)
        except HouseManagerError as err:
            raise HomeAssistantError(str(err)) from err

    async def create_task(call: ServiceCall) -> ServiceResponse:
        manager = get_manager(hass)
        asset_id = None
        if asset_name := call.data.get("asset"):
            asset_id = next(
                (
                    a["id"]
                    for a in manager.assets.values()
                    if a["name"].lower() == asset_name.lower()
                ),
                None,
            )
            if asset_id is None:
                raise HomeAssistantError(f"No asset named '{asset_name}'")
        try:
            task = manager.save_task(
                {
                    "title": call.data["title"],
                    "notes": call.data.get("notes", ""),
                    "asset_id": asset_id,
                    "schedule": {
                        "type": "once",
                        "date": str(call.data.get("date") or dt_util.now().date()),
                    },
                    # Without a date the task goes on the list right away.
                    "open_now": not call.data.get("date"),
                }
            )
        except HouseManagerError as err:
            raise HomeAssistantError(str(err)) from err
        return {"task_id": task["id"]}

    async def send_digest(call: ServiceCall) -> None:
        await get_manager(hass).async_send_digest(force=True)

    hass.services.async_register(
        DOMAIN, "complete_task", complete_task, vol.Schema({vol.Required("task_id"): cv.string})
    )
    hass.services.async_register(
        DOMAIN,
        "create_task",
        create_task,
        vol.Schema(
            {
                vol.Required("title"): cv.string,
                vol.Optional("notes"): cv.string,
                vol.Optional("asset"): cv.string,
                vol.Optional("date"): cv.date,
            }
        ),
        supports_response=SupportsResponse.OPTIONAL,
    )
    hass.services.async_register(DOMAIN, "send_digest", send_digest)
