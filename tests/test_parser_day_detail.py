"""Tests for the day-detail parser."""

from __future__ import annotations

from datetime import date

from msb_extractor.models import DataSource, SetStatus
from msb_extractor.parser.day_detail import parse_day_detail_html


def test_empty_html_returns_none() -> None:
    assert parse_day_detail_html("<html></html>", "2025-03-29") is None


def test_html_without_actuals_gate_returns_none() -> None:
    html = "<html><body><li class='Program-Editor-Exercise'></li></body></html>"
    assert parse_day_detail_html(html, "2025-03-29") is None


def test_invalid_date_string_returns_none(day_detail_html: str) -> None:
    assert parse_day_detail_html(day_detail_html, "not-a-date") is None


def test_parses_full_day(day_detail_html: str) -> None:
    day = parse_day_detail_html(day_detail_html, "2025-03-29")
    assert day is not None
    assert day.date == date(2025, 3, 29)
    assert day.data_source == DataSource.FULL_DETAIL
    assert len(day.exercises) == 2


def test_first_exercise_actuals(day_detail_html: str) -> None:
    day = parse_day_detail_html(day_detail_html, "2025-03-29")
    assert day is not None
    bench = day.exercises[0]
    assert bench.name == "Competition (bench)"
    assert bench.order == "A"
    assert len(bench.actuals) == 2

    set1 = bench.actuals[0]
    assert set1.set_number == 1
    assert set1.reps == 3
    assert set1.rpe == 5.5
    assert set1.load_kg == 180.0
    assert set1.percent_1rm is not None
    assert abs(set1.percent_1rm - 0.89) < 1e-9
    assert set1.e1rm_kg == 225.0
    assert set1.comment is not None
    assert "symposium" in set1.comment

    set2 = bench.actuals[1]
    assert set2.set_number == 2
    assert set2.video_url == "https://example.com/video/abc"
    assert set2.comment is None


def test_prescribed_statuses_attached(day_detail_html: str) -> None:
    day = parse_day_detail_html(day_detail_html, "2025-03-29")
    assert day is not None
    bench = day.exercises[0]
    assert bench.prescribed[0].status == SetStatus.COMPLETED
