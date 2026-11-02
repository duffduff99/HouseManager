"""Sensor showing how many household tasks are open."""

from __future__ import annotations

from homeassistant.components.sensor import SensorEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import SIGNAL_UPDATED
from .manager import HouseManager


async def async_setup_entry(
    hass: HomeAssistant, entry, async_add_entities: AddEntitiesCallback
) -> None:
    async_add_entities([OpenTasksSensor(entry.runtime_data, entry.entry_id)])


class OpenTasksSensor(SensorEntity):
    _attr_has_entity_name = False
    _attr_name = "House Maintenance Open Tasks"
    _attr_icon = "mdi:clipboard-check-outline"
    _attr_native_unit_of_measurement = "tasks"
    _attr_should_poll = False

    def __init__(self, manager: HouseManager, entry_id: str) -> None:
        self._manager = manager
        self._attr_unique_id = f"{entry_id}_open_tasks"

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(
            async_dispatcher_connect(self.hass, SIGNAL_UPDATED, self.async_write_ha_state)
        )

    @property
    def native_value(self) -> int:
        return len(self._manager.open_tasks())

    @property
    def extra_state_attributes(self) -> dict:
        return {
            "tasks": [
                {
                    "id": task["id"],
                    "title": task["title"],
                    "asset": self._manager.asset_name(task.get("asset_id")),
                    "opened": task.get("opened_at"),
                }
                for task in self._manager.open_tasks()
            ]
        }
