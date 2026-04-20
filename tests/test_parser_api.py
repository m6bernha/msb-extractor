"""Smoke tests for the v4 API parser.

The JSON field names below are the parser's current best guess at MSB's
response shape (based on the field list the SPA requests and conventional
REST naming). Once a real v4 capture is in hand, verify these assumptions
against actual data and add real fixtures from a sanitised export.
"""

from __future__ import annotations

from datetime import date

from msb_extractor.models import Capture, DataSource
from msb_extractor.parser.api import parse_api_months
from msb_extractor.parser.capture import parse_capture


def _synth_month() -> list[dict]:
    return [
        {
            "_id": "679808396d3a4ba8bb9f8819",
            "primary": "Competition",
            "secondary": "bench",
            "customName": None,
            "primaryMuscleGroup": "Chest",
            "order": 1,
            "utcDate": "20250127",
            "date": "2025-01-27T10:00:00.000Z",
            "notes": "Back to chest paused reps",
            "sets": [
                {
                    "reps": 3,
                    "rpe": 5.5,
                    "load": 180.0,
                    "complete": True,
                    "notes": (
                        "It's symposium week, bad sleep and coffee but hit it clean. "
                        "Felt strong on the lockout despite the deload."
                    ),
                },
                {"reps": 3, "rpe": 6, "load": 182.5, "complete": True, "notes": None},
            ],
        },
        {
            "_id": "679808396d3a4ba8bb9f881a",
            "primary": "Close Grip Bench",
            "secondary": "bench",
            "customName": None,
            "order": 2,
            "utcDate": "20250127",
            "date": "2025-01-27T10:00:00.000Z",
            "sets": [
                {"reps": 8, "rpe": 7.5, "load": 130.0, "complete": True, "notes": "elbows slotted"},
            ],
        },
        {
            "_id": "679808396d3a4ba8bb9f881b",
            "customName": "Squat Accessories",
            "order": 1,
            "utcDate": "20250128",
            "date": "2025-01-28T10:00:00.000Z",
            "sets": [
                {"reps": 10, "rpe": 8, "load": 100.0, "complete": True, "notes": None},
            ],
        },
    ]


def test_parse_api_months_groups_by_date() -> None:
    days = parse_api_months({"2025-01": _synth_month()})
    assert [d.date for d in days] == [date(2025, 1, 27), date(2025, 1, 28)]
    assert [d.data_source for d in days] == [DataSource.FULL_DETAIL, DataSource.FULL_DETAIL]


def test_parse_api_exercise_letters_order() -> None:
    days = parse_api_months({"2025-01": _synth_month()})
    jan27 = days[0]
    orders = [ex.order for ex in jan27.exercises]
    assert orders == ["A", "B"]


def test_full_comment_survives_untruncated() -> None:
    days = parse_api_months({"2025-01": _synth_month()})
    bench = days[0].exercises[0]
    first_comment = bench.actuals[0].comment
    assert first_comment is not None
    assert "symposium week" in first_comment
    assert not first_comment.endswith("...")


def test_custom_name_wins_over_primary_secondary() -> None:
    days = parse_api_months({"2025-01": _synth_month()})
    accessories_day = days[1]
    assert accessories_day.exercises[0].name == "Squat Accessories"


def test_parse_capture_dispatches_to_api_parser() -> None:
    capture = Capture.model_validate(
        {
            "schemaVersion": 4,
            "capturedAt": "2025-01-27T12:00:00Z",
            "source": "app.mystrengthbook.com",
            "apiMonths": {"2025-01": _synth_month()},
        }
    )
    result = parse_capture(capture)
    assert len(result.days) == 2
    assert result.total_sets == 4  # bench 2 + close grip 1 + accessories 1


def test_empty_api_months_is_safe() -> None:
    assert parse_api_months({}) == []
    assert parse_api_months({"2025-01": None}) == []
    assert parse_api_months({"2025-01": {}}) == []


def test_envelope_shapes_accepted() -> None:
    # Some REST endpoints wrap the list in {"docs": [...]}, others in {"data": [...]}.
    wrapped = {"2025-01": {"docs": _synth_month()}}
    assert len(parse_api_months(wrapped)) == 2

    data_wrapped = {"2025-01": {"data": _synth_month()}}
    assert len(parse_api_months(data_wrapped)) == 2


def test_missing_date_is_skipped_not_raised() -> None:
    bad = [{"primary": "Bench", "secondary": "bench", "order": 1, "sets": []}]
    assert parse_api_months({"2025-01": bad}) == []
