"""Recurrence rules for House Manager tasks.

This module is deliberately free of Home Assistant imports so it can be
unit-tested on its own.

A schedule is a plain dict. Supported shapes:

    {"type": "once",    "date": "2026-11-05"}
    {"type": "daily",   "interval": 1, "start": "2026-11-01"}
    {"type": "weekly",  "interval": 1, "weekdays": [4], "start": "2026-11-01"}
    {"type": "monthly", "interval": 3, "day": 1, "start": "2026-01-01"}
    {"type": "yearly",  "dates": ["04-01", "10-01"]}
    {"type": "cron",    "expression": "0 8 * * 5"}

Notes:
* weekdays use Python numbering: 0 = Monday ... 6 = Sunday.
* "interval" means "every N days/weeks/months", counted from "start".
* monthly "day" larger than the month length uses the last day of the month.
* Everything except cron becomes due at midnight (local time) on the day.
* cron uses the standard 5 fields: minute hour day-of-month month day-of-week
  (day-of-week 0 or 7 = Sunday). Supports *, lists (1,15), ranges (1-5) and
  steps (*/2, 1-10/3).
"""

from __future__ import annotations

import calendar
from datetime import date, datetime, time, timedelta, tzinfo

SCHEDULE_TYPES = ("once", "daily", "weekly", "monthly", "yearly", "cron")

# How far ahead to search for the next occurrence. 9 years covers Feb 29.
_MAX_DAYS = 366 * 9


class ScheduleError(ValueError):
    """Raised when a schedule is invalid."""


# --------------------------------------------------------------------------
# Validation
# --------------------------------------------------------------------------


def _parse_date(value, field: str) -> date:
    try:
        return date.fromisoformat(str(value))
    except ValueError as err:
        raise ScheduleError(f"'{field}' must be a date like 2026-11-01") from err


def _positive_int(value, field: str) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError) as err:
        raise ScheduleError(f"'{field}' must be a whole number") from err
    if number < 1:
        raise ScheduleError(f"'{field}' must be 1 or more")
    return number


def normalize(schedule: dict) -> dict:
    """Validate a schedule and return a cleaned copy. Raises ScheduleError."""
    if not isinstance(schedule, dict):
        raise ScheduleError("Schedule must be an object")
    kind = schedule.get("type")
    if kind not in SCHEDULE_TYPES:
        raise ScheduleError(f"Unknown schedule type: {kind}")

    if kind == "once":
        return {"type": kind, "date": _parse_date(schedule.get("date"), "date").isoformat()}

    if kind == "yearly":
        dates = schedule.get("dates") or []
        cleaned = []
        for item in dates:
            try:
                month, day = (int(part) for part in str(item).split("-"))
                # 2024 is a leap year, so Feb 29 is accepted.
                date(2024, month, day)
            except ValueError as err:
                raise ScheduleError(f"Invalid yearly date '{item}', use MM-DD") from err
            cleaned.append(f"{month:02d}-{day:02d}")
        if not cleaned:
            raise ScheduleError("Yearly schedule needs at least one date")
        return {"type": kind, "dates": sorted(set(cleaned))}

    if kind == "cron":
        expression = " ".join(str(schedule.get("expression", "")).split())
        CronExpression(expression)  # raises on error
        return {"type": kind, "expression": expression}

    result = {
        "type": kind,
        "interval": _positive_int(schedule.get("interval", 1), "interval"),
        "start": _parse_date(
            schedule.get("start") or date.today().isoformat(), "start"
        ).isoformat(),
    }
    if kind == "weekly":
        weekdays = sorted({int(day) for day in schedule.get("weekdays") or []})
        if not weekdays or any(day < 0 or day > 6 for day in weekdays):
            raise ScheduleError("Weekly schedule needs weekdays between 0 (Mon) and 6 (Sun)")
        result["weekdays"] = weekdays
    if kind == "monthly":
        day = _positive_int(schedule.get("day", 1), "day")
        if day > 31:
            raise ScheduleError("'day' must be between 1 and 31")
        result["day"] = day
    return result


# --------------------------------------------------------------------------
# Date based schedules
# --------------------------------------------------------------------------


def _matches_day(schedule: dict, day: date) -> bool:
    kind = schedule["type"]
    if kind == "once":
        return day.isoformat() == schedule["date"]
    if kind == "yearly":
        return f"{day.month:02d}-{day.day:02d}" in schedule["dates"]

    start = date.fromisoformat(schedule["start"])
    if day < start:
        return False
    interval = schedule["interval"]

    if kind == "daily":
        return (day - start).days % interval == 0
    if kind == "weekly":
        if day.weekday() not in schedule["weekdays"]:
            return False
        start_monday = start - timedelta(days=start.weekday())
        return ((day - start_monday).days // 7) % interval == 0
    if kind == "monthly":
        months = (day.year - start.year) * 12 + (day.month - start.month)
        if months % interval != 0:
            return False
        last_day = calendar.monthrange(day.year, day.month)[1]
        return day.day == min(schedule["day"], last_day)
    return False


def next_occurrence(schedule: dict, after: datetime) -> datetime | None:
    """Return the first occurrence strictly after ``after``.

    ``after`` must be timezone-aware; the result uses the same timezone.
    Returns None when there are no more occurrences (e.g. a past one-time task).
    """
    tz = after.tzinfo
    if schedule["type"] == "cron":
        return CronExpression(schedule["expression"]).next_after(after)

    day = after.date()
    for _ in range(_MAX_DAYS):
        if _matches_day(schedule, day):
            candidate = datetime.combine(day, time(0, 0), tzinfo=tz)
            if candidate > after:
                return candidate
        day += timedelta(days=1)
        if schedule["type"] == "once" and day.isoformat() > schedule["date"]:
            return None
    return None


# --------------------------------------------------------------------------
# Cron
# --------------------------------------------------------------------------


class CronExpression:
    """A minimal 5-field cron expression evaluator."""

    _RANGES = ((0, 59), (0, 23), (1, 31), (1, 12), (0, 7))
    _NAMES = ("minute", "hour", "day of month", "month", "day of week")

    def __init__(self, expression: str) -> None:
        parts = expression.split()
        if len(parts) != 5:
            raise ScheduleError(
                "Cron expression needs 5 fields: minute hour day-of-month month day-of-week"
            )
        fields = [
            self._parse_field(part, low, high, name)
            for part, (low, high), name in zip(parts, self._RANGES, self._NAMES, strict=True)
        ]
        self.minutes, self.hours, self.days, self.months, weekdays = fields
        # Cron: 0 and 7 are Sunday. Convert to Python numbering (Mon=0).
        self.weekdays = {(day - 1) % 7 for day in weekdays}
        self.day_restricted = parts[2] != "*"
        self.weekday_restricted = parts[4] != "*"

    @staticmethod
    def _parse_field(text: str, low: int, high: int, name: str) -> set[int]:
        values: set[int] = set()
        for chunk in text.split(","):
            step = 1
            if "/" in chunk:
                chunk, step_text = chunk.split("/", 1)
                if not step_text.isdigit() or int(step_text) < 1:
                    raise ScheduleError(f"Bad step in cron {name} field")
                step = int(step_text)
            if chunk == "*":
                start, end = low, high
            elif "-" in chunk:
                start_text, end_text = chunk.split("-", 1)
                if not (start_text.isdigit() and end_text.isdigit()):
                    raise ScheduleError(f"Bad range in cron {name} field")
                start, end = int(start_text), int(end_text)
            elif chunk.isdigit():
                start = end = int(chunk)
                if step != 1:
                    end = high
            else:
                raise ScheduleError(f"Bad value '{chunk}' in cron {name} field")
            if start < low or end > high or start > end:
                raise ScheduleError(f"Cron {name} must be between {low} and {high}")
            values.update(range(start, end + 1, step))
        return values

    def _matches_day(self, day: date) -> bool:
        if day.month not in self.months:
            return False
        day_ok = day.day in self.days
        weekday_ok = day.weekday() in self.weekdays
        # Standard cron rule: if both fields are restricted, either may match.
        if self.day_restricted and self.weekday_restricted:
            return day_ok or weekday_ok
        return day_ok and weekday_ok

    def next_after(self, after: datetime) -> datetime | None:
        tz: tzinfo | None = after.tzinfo
        day = after.date()
        for _ in range(_MAX_DAYS):
            if self._matches_day(day):
                for hour in sorted(self.hours):
                    for minute in sorted(self.minutes):
                        candidate = datetime.combine(day, time(hour, minute), tzinfo=tz)
                        if candidate > after:
                            return candidate
            day += timedelta(days=1)
        return None
