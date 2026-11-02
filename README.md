# House Manager

A Home Assistant integration for keeping a house maintained:

- **Recurring household tasks** (weekly, monthly, quarterly, yearly, specific dates, or cron) that show
  up on a dedicated **House Maintenance** to-do list, separate from your other to-dos.
- **An asset inventory** (water heater, furnace, TV, furniture…) with model/serial numbers, purchase
  info, attached manuals/receipts/photos, and a maintenance history. Exports to CSV for insurance.
- **A daily digest push notification** listing the tasks that appeared.

It adds a **House Manager** page to the HA sidebar with five tabs:

- **Overview**: what's on the list now, what's coming up this week, recently added assets.
- **Tasks**: today's to-do list with filters, plus a history of everything completed, skipped or missed.
- **Schedule**: every task and when it next appears, grouped by date, frequency or asset. Use it to
  review and tidy your maintenance plan.
- **Assets**: the inventory.
- **Settings**: notifications, categories, locations, backup.

## Install

### With HACS (recommended)

1. HACS → ⋮ (top right) → **Custom repositories** → add `https://github.com/duffduff99/HouseManager`,
   type **Integration**.
2. Search HACS for **House Manager** and download it.
3. Restart Home Assistant.
4. **Settings → Devices & services → Add integration → House Manager**.

### Manually

Copy `custom_components/house_manager` into your HA `config/custom_components/` folder, restart, then
add the integration as in step 4.

## What you get

| Thing | Purpose |
|---|---|
| **House Manager** sidebar page | Manage tasks, assets, categories, locations and notifications. |
| `todo.house_maintenance` | Open tasks. Check items off here, in the panel, or in the HA app. Adding an item here creates a one-time task. Completed items stay visible (checked) for 24 hours. |
| `sensor.house_maintenance_open_tasks` | Number of open tasks; the `tasks` attribute lists them. |
| `house_manager.create_task` | Service: add a one-time task (optionally linked to an asset by name, optionally on a future date). |
| `house_manager.complete_task` | Service: complete a task by ID. |
| `house_manager.skip_task` | Service: skip a task by ID (off the list until its next date). |
| `house_manager.send_digest` | Service: send the digest notification now. |
| `house_manager_task_opened` event | Fired whenever a task appears on the to-do list. |
| `house_manager_digest` event | Fired with each daily digest (title, message, task lists). |

### Dashboard card

Add a **To-do list** card to any dashboard:

```yaml
type: todo-list
entity: todo.house_maintenance
```

Or show just the count, using a tile card with `sensor.house_maintenance_open_tasks`.

### Notifications

On **House Manager → Settings**, choose a time and, for each person, tick their phone(s) (these are the
`notify.mobile_app_*` services the HA companion app creates). Once a day at that time each person gets
**one** notification listing the tasks that appeared since the last digest, so your Friday tasks arrive
as a single push instead of 15. Tapping it opens House Manager.

- Each person's digest contains the tasks **assigned to them**, plus unassigned tasks if "Also include
  tasks that aren't assigned to anyone" is ticked (on by default).
- Phones/services under **All tasks** get every task regardless of assignee (useful for a wall tablet).
- **Send digest now** lets you test it.

## How tasks work

- A task is either **to do** (on the list) or **done**.
- **Skip** takes a task off the list without doing it ("no time to vacuum this week"). It comes back at
  its next scheduled date, shows as *Skipped* in the history, and can be undone.
- When its schedule comes around, it appears on the list (at midnight; cron schedules at their exact time).
- If it's still not done when the next occurrence arrives, the old one is logged as **missed** and
  replaced by the new one. Nothing piles up. (Skipping is the deliberate version of this.)
- Tasks can belong to an asset (e.g. "Check softener salt" under the Water Softener) or stand alone
  (e.g. "Vacuum"). An asset's page shows its tasks and every completion/miss, alongside your manual
  maintenance records.
- **One-time tasks**: use the quick-add box on the Overview, add an item on the HA to-do list, or pick
  "One time" when creating a task.
- **Assignee** is optional and lists your HA users. It decides whose digest a task goes in.
- Untick **Active** to pause a task (e.g. seasonal chores you're skipping this year).

### Schedule options

| Repeats | Example |
|---|---|
| One time | Nov 15, 2026 |
| Daily | every 2 days |
| Weekly | every Friday; every other Monday and Thursday |
| Monthly | the 1st of every month; last day (enter 31) |
| Quarterly | the 1st, every 3 months starting from a chosen month |
| Yearly / specific dates | Nov 1; or Apr 1 **and** Oct 1 (seasonal) |
| Custom (cron) | `0 8 * * 5` = Fridays 8am · `0 7 1 4,10 *` = Apr 1 & Oct 1 at 7am |

The task editor shows the next three dates a schedule will appear, so you can check a cron expression
before saving.

## Assets

- **Location** is one per asset and can be nested. Type `Basement > Mechanical Room` in the location
  box and both levels are created. Manage the tree under Settings.
- **Category** is one per asset. Pick one or type a new name.
- **Attachments**: PDFs, photos, anything up to 50 MB each. Maintenance records can have photos too.
- **Retire** an asset when you sell or get rid of it. It records the date and hides the asset from lists
  and exports (tick "Show retired" to include it). Its history is kept. **Delete** removes it completely.
- **Export CSV** exports the assets currently shown (respecting the filters).

### Importing (e.g. from Jira)

**Import CSV** on the Assets tab adds assets from a CSV with these column headers (any order; only
`Name` is required; other columns are ignored):

`Name, Category, Location, Manufacturer, Model Number, Serial Number, Purchase Date, Purchase Price,
Replacement Value, Description, Retired Date`

Dates should be `YYYY-MM-DD`. Easiest approach: export a CSV here first to get the template, then fill it
in from a spreadsheet. Import always **adds** assets; it never updates existing ones, so importing the
same file twice creates duplicates. Attachments aren't included in CSV import/export.

## Data and backups

- All data is in `config/.storage/house_manager.data`; uploaded files are in
  `config/house_manager_files/`. Both are included in normal Home Assistant backups.
- For insurance, keep an **off-site** copy too: Assets → Export CSV (spreadsheet), or Settings →
  Download full data (JSON). Neither includes the attached files, which are only in HA backups.
- Anyone who can log in to your HA can use House Manager (it's not admin-only).

## Development

The project is deliberately simple:

```
custom_components/house_manager/
  __init__.py      setup, sidebar panel, services
  manager.py       all data + logic (tasks, assets, scheduler, digest)
  schedule.py      recurrence rules (pure Python, no HA imports)
  websocket.py     API used by the panel
  http.py          file upload/download
  todo.py          the House Maintenance to-do list entity
  sensor.py        open-task count sensor
  frontend/        the panel: plain JavaScript + Lit, no build step
    lit.js         vendored Lit 3.2.1 (unmodified bundle)
```

**There is no frontend build step.** Edit a `.js` file, then hard-refresh the browser. (If the HA app
caches an old version, bump `VERSION` in `const.py` and `manifest.json`.)

Run the tests (Python 3.13):

```bash
python -m venv .venv && . .venv/bin/activate
```

```bash
pip install -r requirements_test.txt
```

```bash
pytest
```

GitHub Actions runs HA's `hassfest` validator, HACS validation and the tests on every push, plus weekly,
which catches Home Assistant changes that break the integration.

See [docs/DESIGN.md](docs/DESIGN.md) for the design decisions.
