"""Smoke tests for the v4 API parser.

The fixture below mirrors the *real* shape MSB's /api/v1/exercise endpoint
returns (verified against an April 2026 capture):

* ``sets[i]`` is a *prescription group* — top-level ``reps``/``load``/``rpe``
  describe what was prescribed.
* ``sets[i].outcomes`` is a dict keyed by stringified integer; each value is
  one actually-performed set with the real numbers nested under ``outcome``.
* ``sets[i].comments`` is a dict keyed the same way — one free-text comment
  per outcome.

If a future MSB response shape diverges from these assumptions, update this
fixture rather than loosening the assertions.
"""

from __future__ import annotations

from datetime import date

from msb_extractor.models import Capture, DataSource, SetStatus
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
                    "sets": 1,
                    "reps": 3,
                    "rpe": 5.5,
                    "load": 180.0,
                    "percentRepMax": 0,
                    "zone": "top",
                    "equipped": False,
                    "outcomes": {
                        "0": {
                            "status": "completed",
                            "outcome": {"reps": 3, "rpe": 5.5, "load": 180.0, "e1rm": 201.6},
                        },
                    },
                    "comments": {
                        "0": (
                            "It's symposium week, bad sleep and coffee but hit it clean. "
                            "Felt strong on the lockout despite the deload."
                        ),
                    },
                },
                {
                    "sets": 1,
                    "reps": 3,
                    "rpe": 6,
                    "load": 182.5,
                    "outcomes": {
                        "0": {
                            "status": "completed",
                            "outcome": {"reps": 3, "rpe": 6, "load": 182.5, "e1rm": 204.4},
                        },
                    },
                    "comments": {},
                },
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
                {
                    "sets": 1,
                    "reps": 8,
                    "rpe": 7.5,
                    "load": 130.0,
                    "outcomes": {
                        "0": {
                            "status": "completed",
                            "outcome": {"reps": 8, "rpe": 7.5, "load": 130.0},
                        },
                    },
                    "comments": {"0": "elbows slotted"},
                },
            ],
        },
        {
            "_id": "679808396d3a4ba8bb9f881b",
            "customName": "Squat Accessories",
            "order": 1,
            "utcDate": "20250128",
            "date": "2025-01-28T10:00:00.000Z",
            "sets": [
                {
                    "sets": 3,
                    "reps": 10,
                    "rpe": 8,
                    "load": 100.0,
                    "outcomes": {
                        "0": {
                            "status": "completed",
                            "outcome": {"reps": 10, "rpe": 8, "load": 100.0},
                        },
                        "1": {
                            "status": "completed",
                            "outcome": {"reps": 10, "rpe": 8.5, "load": 100.0},
                        },
                        "2": {
                            "status": "completed",
                            "outcome": {"reps": 9, "rpe": 9, "load": 100.0},
                        },
                    },
                    "comments": {
                        "2": "last set grindy",
                    },
                },
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
    # bench (2 entries x 1 outcome) + close grip (1 x 1) + accessories (1 x 3) = 6 actual sets.
    assert result.total_sets == 6


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


def test_outcomes_expand_one_actual_per_outcome() -> None:
    """A 3x10 prescription with 3 outcomes yields 3 distinct ActualSet rows."""
    days = parse_api_months({"2025-01": _synth_month()})
    accessories = days[1].exercises[0]
    assert len(accessories.actuals) == 3
    assert [a.set_number for a in accessories.actuals] == [1, 2, 3]
    assert [a.reps for a in accessories.actuals] == [10, 10, 9]
    assert [a.rpe for a in accessories.actuals] == [8.0, 8.5, 9.0]
    # Only the 3rd outcome had a comment.
    assert accessories.actuals[0].comment is None
    assert accessories.actuals[2].comment == "last set grindy"


def test_status_completed_propagates_from_outcome() -> None:
    days = parse_api_months({"2025-01": _synth_month()})
    bench = days[0].exercises[0]
    assert all(a.status == SetStatus.COMPLETED for a in bench.actuals)


def test_actuals_read_nested_outcome_not_top_level_plan() -> None:
    """Top-level reps/load are the PLAN; actuals must come from outcomes[i].outcome."""
    raw = [
        {
            "primary": "Squat",
            "secondary": "back",
            "order": 1,
            "utcDate": "20250201",
            "date": "2025-02-01T10:00:00Z",
            "sets": [
                {
                    "sets": 1,
                    "reps": 5,  # planned
                    "load": 150.0,  # planned
                    "rpe": 8,
                    "outcomes": {
                        "0": {
                            "status": "completed",
                            # lifter pushed past the plan: 6 reps instead of 5, heavier load.
                            "outcome": {"reps": 6, "load": 155.0, "rpe": 8.5},
                        },
                    },
                    "comments": {},
                },
            ],
        }
    ]
    days = parse_api_months({"2025-02": raw})
    actual = days[0].exercises[0].actuals[0]
    assert actual.reps == 6
    assert actual.load_kg == 155.0
    assert actual.rpe == 8.5


def test_api_probes_pass_through_untouched() -> None:
    """Probe responses are carried to ParseResult verbatim for downstream inspection."""
    probe_payload = {
        "modified": {"ok": True, "status": 200, "body": {"docs": []}},
        "workoutNote": {"ok": False, "status": 404, "error": "HTTP 404", "body": "not found"},
        "personalRecords": {
            "ok": True,
            "status": 200,
            "body": [{"exercise": "bench", "load": 200}],
        },
    }
    capture = Capture.model_validate(
        {
            "schemaVersion": 4,
            "capturedAt": "2025-01-27T12:00:00Z",
            "source": "app.mystrengthbook.com",
            "apiMonths": {"2025-01": _synth_month()},
            "apiProbes": probe_payload,
        }
    )
    result = parse_capture(capture)
    assert result.api_probes == probe_payload


def test_entry_with_no_outcomes_still_shows_as_prescribed_only() -> None:
    """A planned-but-not-performed entry yields 0 actuals and 1 prescribed row."""
    raw = [
        {
            "primary": "Squat",
            "secondary": "back",
            "order": 1,
            "utcDate": "20250201",
            "date": "2025-02-01T10:00:00Z",
            "sets": [
                {"sets": 3, "reps": 5, "load": 150.0, "rpe": 8, "outcomes": {}, "comments": {}}
            ],
        }
    ]
    days = parse_api_months({"2025-02": raw})
    ex = days[0].exercises[0]
    assert ex.actuals == []
    assert len(ex.prescribed) == 1
    assert ex.prescribed[0].sets == 3
    assert ex.prescribed[0].reps == 5
    assert ex.prescribed[0].target_text == "3x5 @ 150.0 kg RPE 8"
