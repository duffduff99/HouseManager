# House Manager design notes

## Goals

1. Track recurring household tasks (cleaning, filters, plants, seasonal chores) separately from other
   to-dos, with one daily push notification.
2. Keep an insurance-grade inventory of household assets, with manuals/photos and maintenance history.
3. Stay simple enough that one person can maintain it with little effort.

## Key decisions

| Decision | Why |
|---|---|
| HA **custom integration** with a sidebar panel (not an add-on) | Creates real HA entities (to-do list, sensor), works with automations and the HA app, included in HA backups, installable via HACS. |
| Integration **owns its to-do entity** instead of using a Local To-do list | Each to-do item *is* a task, so checking it off records history against the right asset. |
| One JSON file via HA's `Store` (no database) | A few hundred assets and a few thousand history rows are small. Easy to back up and inspect. |
| Panel in **plain JS + Lit**, vendored, no build | No Node toolchain needed to make changes. Uses HA theme CSS variables, avoids HA's internal UI components (they change often). |
| Own recurrence engine (`schedule.py`) incl. a small cron parser | No third-party dependency to install or break; fully unit-tested. |
| Files stored on disk, served through an authenticated view and opened with HA signed URLs | Works with HA auth; links expire. Risky types (HTML, SVG…) are forced to download. |

## Data model (`.storage/house_manager.data`)

- `settings`: digest on/off, time, only-when-new, `notify_services` (get every task), and `people`
  `{user_id: {notify_services, include_unassigned}}` (get their own tasks).
- `categories {id: {name}}`, `locations {id: {name, parent_id}}`.
- `assets {id: {name, category_id, location_id, manufacturer, model_number, serial_number, description,
  purchase_date, purchase_price, replacement_value, retired_date, attachments[], created, updated}}`.
- `records {id: {asset_id, date, notes, attachments[]}}`: manual maintenance records.
- `tasks {id: {title, notes, asset_id, assignee, schedule, enabled, status, opened_at, next_due,
  last_completed, last_result, created}}`. `status` is `open` (on the to-do list) or `done`;
  `last_result` says whether the current occurrence was `completed` or `skipped`.
- `history [{task_id, asset_id, title, result: completed|skipped|missed, occurrence, date, user_id}]`: kept
  forever; the panel loads the last ~13 months up front and an asset's full history on its page.

## Task lifecycle

```
             schedule fires                  user checks it or skips it
  done ───────────────────────────▶ open ───────────────────────────▶ done
   ▲                                  │                    (history: completed / skipped)
   │                                  │ schedule fires again while open
   └──────────────────────────────────┘ (history: missed, replaced by the new occurrence)
```

- The scheduler runs once a minute and on startup. After downtime it jumps to the latest occurrence
  instead of replaying each missed one.
- A new task whose schedule matches *today* appears immediately; editing a schedule never opens a task
  immediately unless "Put it on the to-do list now" is ticked.
- One-time tasks appear on their date (or immediately if it's past) and are done for good once completed.

## Possible next steps

- Warranty expiry reminders.
- A calendar entity showing upcoming tasks.
- ZIP export that includes attachments.
