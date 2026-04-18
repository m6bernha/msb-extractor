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


def test_data_full_comment_overrides_truncated_preview() -> None:
    """The scraper writes data-full-comment to carry MSB's full set comment.

    MSB server-renders only a ~40-char preview ending in '...' for long
    per-set comments; the full text is not in the initial HTML. The scraper's
    comment-expansion step injects data-full-comment; the parser must prefer
    it over the visible truncated text.
    """
    full = (
        "1x10 @135lbs, Paused x4\n1x8 @225lbs, Paused x2 slow eccentric, felt the groove come back"
    )
    html = f"""
    <html><body><ul>
    <li class="Program-Editor-Exercise is-actuals">
      <span class="calendar-prefix">A</span>
      <p>Competition (squat)</p>
      <div class="actuals-outcomes-container set0">
        <div class="target-status">
          <span class="circle-status completed"></span>
          <p class="p4">1 x 8 Reps @ 125 kg</p>
        </div>
        <div class="actuals-outcomes">
          <p class="p4 actuals-status"><svg></svg></p>
          <p class="p4">1</p><p class="p4">8</p><p class="p4">7</p>
          <p class="p4">124.9 kg</p>
          <p class="p4 mobile-hidden">68%</p>
          <p class="p4 mobile-hidden">170.7 kg</p>
          <p class="p4 video"></p>
          <p class="p4 description mobile-hidden"
             data-full-comment="{full}">1x10 @135lbs, Paused x4 1x8 @225lbs, Pa...</p>
        </div>
      </div>
    </li>
    </ul></body></html>
    """
    day = parse_day_detail_html(html, "2025-01-27")
    assert day is not None
    squat_set = day.exercises[0].actuals[0]
    assert squat_set.comment == full
    assert squat_set.comment is not None and not squat_set.comment.endswith("...")
