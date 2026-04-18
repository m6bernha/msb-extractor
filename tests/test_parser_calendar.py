"""Tests for the calendar-HTML parser."""

from __future__ import annotations

from datetime import date

from msb_extractor.models import DataSource, SetStatus
from msb_extractor.parser.calendar import parse_calendar_html


def test_empty_html_yields_no_days() -> None:
    assert parse_calendar_html("<html></html>") == []


def test_parses_two_training_days(calendar_html: str) -> None:
    days = parse_calendar_html(calendar_html)
    assert len(days) == 2
    assert [d.date for d in days] == [date(2025, 3, 29), date(2025, 3, 31)]
    for d in days:
        assert d.data_source == DataSource.CALENDAR


def test_first_day_has_two_exercises_with_correct_order(calendar_html: str) -> None:
    days = parse_calendar_html(calendar_html)
    d = days[0]
    assert len(d.exercises) == 2
    assert d.exercises[0].order == "A"
    assert d.exercises[0].name == "Competition (squat)"
    assert d.exercises[1].order == "B"
    assert d.exercises[1].name == "Romanian (deadlift)"


def test_prescribed_sets_parsed_with_status(calendar_html: str) -> None:
    days = parse_calendar_html(calendar_html)
    squat = days[0].exercises[0]
    assert len(squat.prescribed) == 2
    first = squat.prescribed[0]
    assert first.sets == 1
    assert first.reps == 8
    assert first.load_kg == 152.5
    assert first.status == SetStatus.COMPLETED

    rdl = days[0].exercises[1]
    assert rdl.prescribed[0].status == SetStatus.PRESCRIBED


def test_warning_dot_maps_to_partial(calendar_html: str) -> None:
    days = parse_calendar_html(calendar_html)
    bench = days[1].exercises[0]
    assert bench.prescribed[0].status == SetStatus.PARTIAL
