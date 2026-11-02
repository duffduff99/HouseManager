"""Constants for House Manager."""

DOMAIN = "house_manager"
VERSION = "0.2.0"

STORAGE_KEY = "house_manager.data"
STORAGE_VERSION = 1

PANEL_URL_PATH = "house-manager"
PANEL_TITLE = "House Manager"
PANEL_ICON = "mdi:hammer-wrench"
PANEL_ELEMENT = "house-manager-panel"
STATIC_URL = "/house_manager_static"

# Folder (inside the HA config folder) where uploaded files are stored.
FILES_DIR = "house_manager_files"
MAX_UPLOAD_BYTES = 50 * 1024 * 1024

SIGNAL_UPDATED = "house_manager_updated"
EVENT_DIGEST = "house_manager_digest"
EVENT_TASK_OPENED = "house_manager_task_opened"

DEFAULT_CATEGORIES = [
    "Appliances",
    "Electronics",
    "Furniture",
    "Laundry and Mechanical",
    "Outdoor and Yard",
    "Theater and AV",
    "Tools",
]

DEFAULT_SETTINGS = {
    "digest_enabled": True,
    "digest_time": "07:00",
    "digest_only_new": True,
    # Notify services that get every task, whoever it's assigned to.
    "notify_services": [],
    # Per HA user: {"notify_services": [...], "include_unassigned": bool}.
    # Each person's digest has their tasks (and unassigned ones if chosen).
    "people": {},
}

# Completed tasks stay visible (checked) on the HA to-do list for this long.
SHOW_COMPLETED_HOURS = 24
