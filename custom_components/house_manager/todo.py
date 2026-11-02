"""A Home Assistant to-do list ("House Maintenance") backed by House Manager tasks.

* Open tasks show as unchecked items.
* Tasks completed in the last day show as checked items (un-check to reopen).
* Checking an item completes the task, which is recorded in its history.
* Adding an item creates a one-time task that is open right away.
"""

from __future__ import annotations

from homeassistant.components.todo import (
    TodoItem,
    TodoItemStatus,
    TodoListEntity,
    TodoListEntityFeature,
)
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.util import dt as dt_util

from .const import SHOW_COMPLETED_HOURS, SIGNAL_UPDATED
from .manager import HouseManager


async def async_setup_entry(
    hass: HomeAssistant, entry, async_add_entities: AddEntitiesCallback
) -> None:
    async_add_entities([HouseMaintenanceTodo(entry.runtime_data, entry.entry_id)])


class HouseMaintenanceTodo(TodoListEntity):
    _attr_has_entity_name = False
    _attr_name = "House Maintenance"
    _attr_icon = "mdi:hammer-wrench"
    _attr_should_poll = False
    # Descriptions (asset name and notes) are shown but edited in the panel.
    _attr_supported_features = (
        TodoListEntityFeature.CREATE_TODO_ITEM | TodoListEntityFeature.UPDATE_TODO_ITEM
    )

    def __init__(self, manager: HouseManager, entry_id: str) -> None:
        self._manager = manager
        self._attr_unique_id = f"{entry_id}_todo"

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(
            async_dispatcher_connect(self.hass, SIGNAL_UPDATED, self.async_write_ha_state)
        )

    def _description(self, task: dict) -> str | None:
        parts = []
        if asset := self._manager.asset_name(task.get("asset_id")):
            parts.append(asset)
        if task.get("notes"):
            parts.append(task["notes"])
        return " - ".join(parts) or None

    @property
    def todo_items(self) -> list[TodoItem]:
        items = [
            TodoItem(
                uid=task["id"],
                summary=task["title"],
                status=TodoItemStatus.NEEDS_ACTION,
                description=self._description(task),
            )
            for task in self._manager.open_tasks()
        ]
        items.extend(
            TodoItem(
                uid=task["id"],
                summary=task["title"],
                status=TodoItemStatus.COMPLETED,
                description=self._description(task),
            )
            for task in self._manager.recently_completed_tasks(SHOW_COMPLETED_HOURS)
        )
        return items

    async def async_create_todo_item(self, item: TodoItem) -> None:
        self._manager.save_task(
            {
                "title": item.summary or "New task",
                "schedule": {"type": "once", "date": dt_util.now().date().isoformat()},
                "open_now": True,
            }
        )

    async def async_update_todo_item(self, item: TodoItem) -> None:
        task = self._manager.tasks.get(item.uid)
        if task is None:
            raise HomeAssistantError("This task no longer exists")
        if item.summary and item.summary != task["title"]:
            self._manager.save_task({"id": task["id"], "title": item.summary})
        if item.status == TodoItemStatus.COMPLETED and task["status"] == "open":
            user_id = self._context.user_id if self._context else None
            self._manager.complete_task(task["id"], user_id)
        elif item.status == TodoItemStatus.NEEDS_ACTION and task["status"] != "open":
            self._manager.reopen_task(task["id"])
        self.async_write_ha_state()
