"""Tests for the recurrence rules (no Home Assistant needed)."""

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from custom_components.house_manager.schedule import ScheduleError, next_occurrence, normalize

TZ = ZoneInfo("America/Chicago")


def at(text: str) -> datetime:
    return datetime.fromisoformat(text).replace(tzinfo=TZ)


def nxt(schedule: dict, after: str) -> str | None:
    result = next_occurrence(normalize(schedule), at(after))
    return result.strftime("%Y-%m-%d %H:%M") if result else None


def test_weekly_friday():
    # 2026-11-02 is a Monday.
    rule = {"type": "weekly", "weekdays": [4], "start": "2026-11-01"}
    assert nxt(rule, "2026-11-02 10:00") == "2026-11-06 00:00"
    assert nxt(rule, "2026-11-06 00:00") == "2026-11-13 00:00"


def test_every_other_week():
    rule = {"type": "weekly", "weekdays": [0], "interval": 2, "start": "2026-11-02"}
    assert nxt(rule, "2026-11-01 00:00") == "2026-11-02 00:00"
    assert nxt(rule, "2026-11-02 00:00") == "2026-11-16 00:00"


def test_monthly_and_quarterly():
    assert (
        nxt({"type": "monthly", "day": 1, "start": "2026-01-01"}, "2026-11-02 08:00")
        == "2026-12-01 00:00"
    )
    quarterly = {"type": "monthly", "day": 1, "interval": 3, "start": "2026-01-01"}
    assert nxt(quarterly, "2026-11-02 08:00") == "2027-01-01 00:00"


def test_monthly_day_31_uses_last_day():
    rule = {"type": "monthly", "day": 31, "start": "2026-01-01"}
    assert nxt(rule, "2027-02-01 00:00") == "2027-02-28 00:00"


def test_yearly_and_seasonal():
    assert nxt({"type": "yearly", "dates": ["11-01"]}, "2026-11-02 00:00") == "2027-11-01 00:00"
    seasonal = {"type": "yearly", "dates": ["04-01", "10-01"]}
    assert nxt(seasonal, "2026-11-02 00:00") == "2027-04-01 00:00"
    assert nxt(seasonal, "2027-04-01 00:00") == "2027-10-01 00:00"


def test_daily_interval():
    assert (
        nxt({"type": "daily", "interval": 3, "start": "2026-11-01"}, "2026-11-02 00:00")
        == "2026-11-04 00:00"
    )


def test_once():
    rule = {"type": "once", "date": "2026-11-10"}
    assert nxt(rule, "2026-11-02 00:00") == "2026-11-10 00:00"
    assert nxt(rule, "2026-11-10 00:00") is None


def test_cron():
    # Fridays at 08:30
    assert (
        nxt({"type": "cron", "expression": "30 8 * * 5"}, "2026-11-02 00:00") == "2026-11-06 08:30"
    )
    # Every 15 minutes
    assert (
        nxt({"type": "cron", "expression": "*/15 * * * *"}, "2026-11-02 10:07")
        == "2026-11-02 10:15"
    )
    # Sunday as 0 and as 7
    assert (
        nxt({"type": "cron", "expression": "0 9 * * 0"}, "2026-11-02 00:00") == "2026-11-08 09:00"
    )
    assert (
        nxt({"type": "cron", "expression": "0 9 * * 7"}, "2026-11-02 00:00") == "2026-11-08 09:00"
    )
    # 1st of Apr and Oct at 7am
    assert (
        nxt({"type": "cron", "expression": "0 7 1 4,10 *"}, "2026-11-02 00:00")
        == "2027-04-01 07:00"
    )


@pytest.mark.parametrize(
    "rule",
    [
        {"type": "nope"},
        {"type": "weekly", "weekdays": []},
        {"type": "monthly", "day": 40},
        {"type": "yearly", "dates": ["13-01"]},
        {"type": "cron", "expression": "* * *"},
        {"type": "cron", "expression": "61 * * * *"},
        {"type": "once", "date": "soon"},
    ],
)
def test_invalid(rule):
    with pytest.raises(ScheduleError):
        normalize(rule)
