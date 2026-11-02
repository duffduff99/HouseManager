"""Core data and logic for House Manager.

All data lives in a single JSON file in Home Assistant's storage folder
(`.storage/house_manager.data`), so it is included in normal HA backups.
Uploaded files live in `<config>/house_manager_files/`.
"""

from __future__ import annotations

from datetime import datetime, timedelta
import logging
from pathlib import Path
import shutil
from typing import Any

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import async_track_time_change
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util
from homeassistant.util.ulid import ulid_now

from .const import (
    DEFAULT_CATEGORIES,
    DEFAULT_SETTINGS,
    EVENT_DIGEST,
    EVENT_TASK_OPENED,
    FILES_DIR,
    SIGNAL_UPDATED,
    STORAGE_KEY,
    STORAGE_VERSION,
)
from .schedule import next_occurrence, normalize

_LOGGER = logging.getLogger(__name__)

# How many days of task history the panel loads up front. Older history is
# still kept and is loaded on demand for a single asset or task.
SNAPSHOT_HISTORY_DAYS = 400

LOCATION_SEPARATOR = " > "

ASSET_FIELDS = (
    "name",
    "category_id",
    "location_id",
    "manufacturer",
    "model_number",
    "serial_number",
    "description",
    "purchase_date",
    "purchase_price",
    "replacement_value",
    "retired_date",
)


class HouseManagerError(Exception):
    """Raised for user-facing errors (bad input, unknown ids)."""


class HouseManager:
    """Holds all House Manager data and runs the task scheduler."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store: Store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self.data: dict[str, Any] = {}
        self.files_dir = Path(hass.config.path(FILES_DIR))
        self._unsub_timer = None

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def async_load(self) -> None:
        stored = await self._store.async_load()
        first_run = stored is None
        stored = stored or {}
        self.data = {
            "settings": {**DEFAULT_SETTINGS, **stored.get("settings", {})},
            "categories": stored.get("categories", {}),
            "locations": stored.get("locations", {}),
            "assets": stored.get("assets", {}),
            "records": stored.get("records", {}),
            "tasks": stored.get("tasks", {}),
            "history": stored.get("history", []),
            "meta": stored.get("meta", {}),
        }
        if first_run:
            for name in DEFAULT_CATEGORIES:
                new_id = ulid_now()
                self.data["categories"][new_id] = {"id": new_id, "name": name}
            self._save()

    async def async_start(self) -> None:
        """Catch up on anything that became due while HA was off, then tick."""
        self._process_due(dt_util.now())
        self._unsub_timer = async_track_time_change(self.hass, self._async_tick, second=0)

    async def async_stop(self) -> None:
        if self._unsub_timer:
            self._unsub_timer()
            self._unsub_timer = None
        await self._store.async_save(self.data)

    @callback
    def _save(self) -> None:
        self._store.async_delay_save(lambda: self.data, 1)
        async_dispatcher_send(self.hass, SIGNAL_UPDATED)

    async def _async_tick(self, now: datetime) -> None:
        self._process_due(now)
        await self._async_maybe_send_digest(now)

    # ------------------------------------------------------------------
    # Read helpers
    # ------------------------------------------------------------------

    @property
    def tasks(self) -> dict[str, dict]:
        return self.data["tasks"]

    @property
    def assets(self) -> dict[str, dict]:
        return self.data["assets"]

    def open_tasks(self) -> list[dict]:
        """Open (to-do) tasks, oldest first."""
        tasks = [t for t in self.tasks.values() if t["enabled"] and t["status"] == "open"]
        return sorted(tasks, key=lambda t: (t.get("opened_at") or "", t["title"].lower()))

    def recently_completed_tasks(self, hours: int) -> list[dict]:
        cutoff = dt_util.now() - timedelta(hours=hours)
        result = []
        for task in self.tasks.values():
            done = task.get("last_completed")
            if task["enabled"] and task["status"] == "done" and done:
                if dt_util.parse_datetime(done) >= cutoff:
                    result.append(task)
        return result

    def asset_name(self, asset_id: str | None) -> str | None:
        asset = self.assets.get(asset_id) if asset_id else None
        return asset["name"] if asset else None

    def location_path(self, location_id: str | None) -> str:
        names = []
        seen = set()
        locations = self.data["locations"]
        while location_id and location_id in locations and location_id not in seen:
            seen.add(location_id)
            names.append(locations[location_id]["name"])
            location_id = locations[location_id].get("parent_id")
        return LOCATION_SEPARATOR.join(reversed(names))

    async def async_get_users(self) -> list[dict]:
        users = await self.hass.auth.async_get_users()
        return sorted(
            (
                {"id": user.id, "name": user.name or "Unnamed user"}
                for user in users
                if user.is_active and not user.system_generated
            ),
            key=lambda u: u["name"].lower(),
        )

    def notify_services(self) -> list[str]:
        return sorted(self.hass.services.async_services().get("notify", {}).keys())

    async def async_snapshot(self) -> dict:
        """Everything the panel needs in one response."""
        cutoff = (dt_util.now() - timedelta(days=SNAPSHOT_HISTORY_DAYS)).isoformat()
        return {
            "settings": self.data["settings"],
            "categories": list(self.data["categories"].values()),
            "locations": list(self.data["locations"].values()),
            "assets": list(self.assets.values()),
            "records": list(self.data["records"].values()),
            "tasks": list(self.tasks.values()),
            "history": [h for h in self.data["history"] if (h.get("date") or "") >= cutoff],
            "users": await self.async_get_users(),
            "notify_services": self.notify_services(),
            "now": dt_util.now().isoformat(),
        }

    def history_for(self, asset_id: str | None = None, task_id: str | None = None) -> list[dict]:
        """History for one asset or task, or everything if neither is given."""
        if not asset_id and not task_id:
            return list(self.data["history"])
        return [
            h
            for h in self.data["history"]
            if (asset_id and h.get("asset_id") == asset_id)
            or (task_id and h.get("task_id") == task_id)
        ]

    # ------------------------------------------------------------------
    # Scheduler
    # ------------------------------------------------------------------

    @callback
    def _process_due(self, now: datetime) -> None:
        """Open every task whose next occurrence has arrived.

        If a task is still open from its previous occurrence, that occurrence
        is logged as "missed" and replaced by the new one.
        """
        opened = []
        for task in self.tasks.values():
            if not task["enabled"] or not task.get("next_due"):
                continue
            due = dt_util.parse_datetime(task["next_due"])
            if due is None or due > now:
                continue

            # If HA was off for a while, skip forward to the latest occurrence.
            upcoming = next_occurrence(task["schedule"], due)
            for _ in range(1000):
                if upcoming is None or upcoming > now:
                    break
                due, upcoming = upcoming, next_occurrence(task["schedule"], upcoming)

            if task["status"] == "open":
                self._add_history(task, "missed", None)
            task["status"] = "open"
            task["opened_at"] = due.isoformat()
            task["next_due"] = upcoming.isoformat() if upcoming else None
            opened.append(task)

        if opened:
            for task in opened:
                self.hass.bus.async_fire(
                    EVENT_TASK_OPENED,
                    {
                        "task_id": task["id"],
                        "title": task["title"],
                        "asset": self.asset_name(task.get("asset_id")),
                        "assignee": task.get("assignee"),
                    },
                )
            self._save()

    def _add_history(self, task: dict, result: str, user_id: str | None) -> None:
        self.data["history"].append(
            {
                "id": ulid_now(),
                "task_id": task["id"],
                "asset_id": task.get("asset_id"),
                "title": task["title"],
                "result": result,  # "completed" or "missed"
                "occurrence": task.get("opened_at"),
                "date": dt_util.now().isoformat(),
                "user_id": user_id,
            }
        )

    def _schedule_next(self, task: dict, include_today: bool) -> None:
        """Work out when a task should next appear on the to-do list."""
        schedule = task["schedule"]
        if schedule["type"] == "once":
            # One-time tasks appear on their date (or right away if the date
            # has passed) until they are completed once.
            if task.get("last_completed") or task["status"] == "open":
                task["next_due"] = None
            else:
                start = dt_util.start_of_local_day(dt_util.parse_date(schedule["date"]))
                task["next_due"] = start.isoformat()
            return
        now = dt_util.now()
        after = dt_util.start_of_local_day() - timedelta(seconds=1) if include_today else now
        upcoming = next_occurrence(schedule, after)
        task["next_due"] = upcoming.isoformat() if upcoming else None

    # ------------------------------------------------------------------
    # Tasks
    # ------------------------------------------------------------------

    def _get(self, collection: str, item_id: str) -> dict:
        item = self.data[collection].get(item_id)
        if item is None:
            raise HouseManagerError(f"Unknown {collection[:-1]}: {item_id}")
        return item

    def _check_refs(self, asset_id=None, category_id=None, location_id=None) -> None:
        if asset_id:
            self._get("assets", asset_id)
        if category_id:
            self._get("categories", category_id)
        if location_id:
            self._get("locations", location_id)

    @callback
    def save_task(self, data: dict) -> dict:
        """Create (no id) or update (with id) a task."""
        try:
            schedule = normalize(data["schedule"]) if "schedule" in data else None
        except ValueError as err:
            raise HouseManagerError(str(err)) from err
        self._check_refs(asset_id=data.get("asset_id"))
        open_now = data.get("open_now", False)
        now = dt_util.now()

        if data.get("id"):
            task = self._get("tasks", data["id"])
            reschedule = False
            for key in ("title", "notes", "asset_id", "assignee"):
                if key in data:
                    task[key] = data[key]
            if "enabled" in data and data["enabled"] != task["enabled"]:
                task["enabled"] = data["enabled"]
                reschedule = True
            if schedule is not None and schedule != task["schedule"]:
                task["schedule"] = schedule
                reschedule = True
            if reschedule:
                self._schedule_next(task, include_today=False)
        else:
            if schedule is None:
                raise HouseManagerError("A schedule is required")
            task = {
                "id": ulid_now(),
                "title": data["title"],
                "notes": data.get("notes", ""),
                "asset_id": data.get("asset_id"),
                "assignee": data.get("assignee"),
                "schedule": schedule,
                "enabled": data.get("enabled", True),
                "status": "done",
                "opened_at": None,
                "next_due": None,
                "last_completed": None,
                "created": now.isoformat(),
            }
            self.tasks[task["id"]] = task
            if not open_now:
                self._schedule_next(task, include_today=True)

        if open_now and task["status"] != "open":
            task["status"] = "open"
            task["opened_at"] = now.isoformat()
            if task["schedule"]["type"] == "once":
                task["next_due"] = None
            else:
                self._schedule_next(task, include_today=False)

        self._save()
        self._process_due(now)
        return task

    @callback
    def delete_task(self, task_id: str) -> None:
        self._get("tasks", task_id)
        del self.tasks[task_id]
        self._save()

    @callback
    def complete_task(self, task_id: str, user_id: str | None = None) -> dict:
        task = self._get("tasks", task_id)
        if task["status"] != "open":
            return task
        self._add_history(task, "completed", user_id)
        task["status"] = "done"
        task["last_completed"] = dt_util.now().isoformat()
        self._save()
        return task

    @callback
    def reopen_task(self, task_id: str) -> dict:
        """Undo a completion (e.g. un-checking it on the to-do list)."""
        task = self._get("tasks", task_id)
        if task["status"] == "open":
            return task
        history = self.data["history"]
        for index in range(len(history) - 1, -1, -1):
            entry = history[index]
            if entry["task_id"] == task_id:
                if entry["result"] == "completed" and entry.get("occurrence") == task.get(
                    "opened_at"
                ):
                    del history[index]
                break
        task["status"] = "open"
        task["last_completed"] = None
        if not task.get("opened_at"):
            task["opened_at"] = dt_util.now().isoformat()
        self._save()
        return task

    # ------------------------------------------------------------------
    # Categories and locations
    # ------------------------------------------------------------------

    @callback
    def save_category(self, data: dict) -> dict:
        name = data["name"].strip()
        if not name:
            raise HouseManagerError("Category name is required")
        for other in self.data["categories"].values():
            if other["name"].lower() == name.lower() and other["id"] != data.get("id"):
                raise HouseManagerError(f"Category '{name}' already exists")
        if data.get("id"):
            category = self._get("categories", data["id"])
            category["name"] = name
        else:
            category = {"id": ulid_now(), "name": name}
            self.data["categories"][category["id"]] = category
        self._save()
        return category

    @callback
    def delete_category(self, category_id: str) -> None:
        self._get("categories", category_id)
        del self.data["categories"][category_id]
        for asset in self.assets.values():
            if asset.get("category_id") == category_id:
                asset["category_id"] = None
        self._save()

    def category_id_for_name(self, name: str | None) -> str | None:
        """Find a category by name, creating it if needed."""
        name = (name or "").strip()
        if not name:
            return None
        for category in self.data["categories"].values():
            if category["name"].lower() == name.lower():
                return category["id"]
        return self.save_category({"name": name})["id"]

    @callback
    def save_location(self, data: dict) -> dict:
        locations = self.data["locations"]
        name = data["name"].strip()
        if not name or LOCATION_SEPARATOR.strip() in name:
            raise HouseManagerError("Location name is required and cannot contain '>'")
        parent_id = data.get("parent_id") or None
        if parent_id:
            self._get("locations", parent_id)
        if data.get("id"):
            location = self._get("locations", data["id"])
            # Prevent a location from becoming its own ancestor.
            walker = parent_id
            while walker:
                if walker == location["id"]:
                    raise HouseManagerError("A location cannot be inside itself")
                walker = locations[walker].get("parent_id")
            location["name"] = name
            location["parent_id"] = parent_id
        else:
            location = {"id": ulid_now(), "name": name, "parent_id": parent_id}
            locations[location["id"]] = location
        self._save()
        return location

    @callback
    def delete_location(self, location_id: str) -> None:
        location = self._get("locations", location_id)
        parent_id = location.get("parent_id")
        del self.data["locations"][location_id]
        # Children and assets move up to the parent location.
        for other in self.data["locations"].values():
            if other.get("parent_id") == location_id:
                other["parent_id"] = parent_id
        for asset in self.assets.values():
            if asset.get("location_id") == location_id:
                asset["location_id"] = parent_id
        self._save()

    def location_id_for_path(self, path: str | None) -> str | None:
        """Find a location by its path ("Basement > Laundry"), creating parts as needed."""
        parts = [part.strip() for part in (path or "").split(">") if part.strip()]
        parent_id = None
        for part in parts:
            match = next(
                (
                    loc
                    for loc in self.data["locations"].values()
                    if loc["name"].lower() == part.lower() and loc.get("parent_id") == parent_id
                ),
                None,
            )
            if match is None:
                match = self.save_location({"name": part, "parent_id": parent_id})
            parent_id = match["id"]
        return parent_id

    # ------------------------------------------------------------------
    # Assets and maintenance records
    # ------------------------------------------------------------------

    @callback
    def save_asset(self, data: dict) -> dict:
        data = dict(data)
        if "category_name" in data:
            data["category_id"] = self.category_id_for_name(data.pop("category_name"))
        if "location_path" in data:
            data["location_id"] = self.location_id_for_path(data.pop("location_path"))
        self._check_refs(category_id=data.get("category_id"), location_id=data.get("location_id"))

        now = dt_util.now().isoformat()
        if data.get("id"):
            asset = self._get("assets", data["id"])
        else:
            if not (data.get("name") or "").strip():
                raise HouseManagerError("Asset name is required")
            asset = {"id": ulid_now(), "attachments": [], "created": now}
            for field in ASSET_FIELDS:
                asset[field] = None
            self.assets[asset["id"]] = asset
        for field in ASSET_FIELDS:
            if field in data:
                asset[field] = data[field]
        asset["updated"] = now
        self._save()
        return asset

    @callback
    def import_assets(self, rows: list[dict]) -> int:
        for row in rows:
            self.save_asset({k: v for k, v in row.items() if k != "id"})
        return len(rows)

    async def async_delete_asset(self, asset_id: str) -> None:
        asset = self._get("assets", asset_id)
        records = [r for r in self.data["records"].values() if r["asset_id"] == asset_id]
        files = [a["id"] for a in asset["attachments"]]
        for record in records:
            files.extend(a["id"] for a in record["attachments"])
            del self.data["records"][record["id"]]
        del self.assets[asset_id]
        for task in self.tasks.values():
            if task.get("asset_id") == asset_id:
                task["asset_id"] = None
        self._save()
        await self.hass.async_add_executor_job(self._remove_files, files)

    @callback
    def save_record(self, data: dict) -> dict:
        if data.get("id"):
            record = self._get("records", data["id"])
        else:
            self._check_refs(asset_id=data["asset_id"])
            record = {
                "id": ulid_now(),
                "asset_id": data["asset_id"],
                "attachments": [],
                "created": dt_util.now().isoformat(),
            }
            self.data["records"][record["id"]] = record
        record["date"] = data.get("date") or record.get("date") or dt_util.now().date().isoformat()
        record["notes"] = data.get("notes", record.get("notes", ""))
        self._save()
        return record

    async def async_delete_record(self, record_id: str) -> None:
        record = self._get("records", record_id)
        del self.data["records"][record_id]
        self._save()
        await self.hass.async_add_executor_job(
            self._remove_files, [a["id"] for a in record["attachments"]]
        )

    # ------------------------------------------------------------------
    # Attachments
    # ------------------------------------------------------------------

    def attachment_owner(self, owner_type: str, owner_id: str) -> dict:
        if owner_type == "asset":
            return self._get("assets", owner_id)
        if owner_type == "record":
            return self._get("records", owner_id)
        raise HouseManagerError(f"Attachments are not supported on {owner_type}")

    def file_path(self, attachment_id: str) -> Path:
        # Attachment ids are ULIDs we generated, so they are safe file names.
        return self.files_dir / attachment_id

    def find_attachment(self, attachment_id: str) -> dict | None:
        for collection in ("assets", "records"):
            for owner in self.data[collection].values():
                for attachment in owner.get("attachments", []):
                    if attachment["id"] == attachment_id:
                        return attachment
        return None

    @callback
    def add_attachment(self, owner: dict, attachment: dict) -> None:
        owner.setdefault("attachments", []).append(attachment)
        self._save()

    async def async_delete_attachment(self, attachment_id: str) -> None:
        for collection in ("assets", "records"):
            for owner in self.data[collection].values():
                attachments = owner.get("attachments", [])
                for attachment in attachments:
                    if attachment["id"] == attachment_id:
                        attachments.remove(attachment)
                        self._save()
                        await self.hass.async_add_executor_job(self._remove_files, [attachment_id])
                        return
        raise HouseManagerError("Attachment not found")

    def _remove_files(self, attachment_ids: list[str]) -> None:
        for attachment_id in attachment_ids:
            self.file_path(attachment_id).unlink(missing_ok=True)

    # ------------------------------------------------------------------
    # Settings and daily digest
    # ------------------------------------------------------------------

    @callback
    def save_settings(self, data: dict) -> dict:
        settings = self.data["settings"]
        if "digest_time" in data:
            try:
                hour, minute = (int(x) for x in data["digest_time"].split(":")[:2])
                if not (0 <= hour < 24 and 0 <= minute < 60):
                    raise ValueError
            except ValueError as err:
                raise HouseManagerError("Digest time must look like 07:00") from err
            data = {**data, "digest_time": f"{hour:02d}:{minute:02d}"}
        settings.update(data)
        self._save()
        return settings

    async def _async_maybe_send_digest(self, now: datetime) -> None:
        settings = self.data["settings"]
        if not settings["digest_enabled"]:
            return
        hour, minute = (int(x) for x in settings["digest_time"].split(":"))
        if (now.hour, now.minute) < (hour, minute):
            return
        if self.data["meta"].get("last_digest_date") == now.date().isoformat():
            return
        await self.async_send_digest()

    async def async_send_digest(self, force: bool = False) -> bool:
        """Send the daily summary. Returns True if a notification was sent."""
        now = dt_util.now()
        meta = self.data["meta"]
        last = dt_util.parse_datetime(meta["last_digest"]) if meta.get("last_digest") else None
        meta["last_digest"] = now.isoformat()
        meta["last_digest_date"] = now.date().isoformat()
        self._save()

        open_tasks = self.open_tasks()
        new_tasks = [
            t for t in open_tasks if last is None or dt_util.parse_datetime(t["opened_at"]) > last
        ]
        if not open_tasks:
            return False
        if self.data["settings"]["digest_only_new"] and not new_tasks and not force:
            return False

        listed = new_tasks or open_tasks
        if new_tasks:
            title = f"{len(new_tasks)} new household task{'s' if len(new_tasks) != 1 else ''}"
        else:
            title = f"{len(open_tasks)} open household task{'s' if len(open_tasks) != 1 else ''}"
        lines = []
        for task in listed[:15]:
            asset = self.asset_name(task.get("asset_id"))
            lines.append(f"• {task['title']}" + (f" ({asset})" if asset else ""))
        if len(listed) > 15:
            lines.append(f"…and {len(listed) - 15} more")
        lines.append(f"{len(open_tasks)} open in total.")
        message = "\n".join(lines)

        self.hass.bus.async_fire(
            EVENT_DIGEST,
            {
                "title": title,
                "message": message,
                "new_tasks": [t["title"] for t in new_tasks],
                "open_tasks": [t["title"] for t in open_tasks],
            },
        )
        for service in self.data["settings"]["notify_services"]:
            if not self.hass.services.has_service("notify", service):
                _LOGGER.warning("Notify service notify.%s not found", service)
                continue
            await self.hass.services.async_call(
                "notify",
                service,
                {
                    "title": title,
                    "message": message,
                    "data": {"url": "/house-manager", "clickAction": "/house-manager"},
                },
            )
        return True

    async def async_remove_all_files(self) -> None:
        """Used when the integration is deleted."""
        await self.hass.async_add_executor_job(shutil.rmtree, self.files_dir, True)
