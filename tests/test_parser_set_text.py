"""Tests for ``parse_set_text`` — the small free-form prescription parser."""

from __future__ import annotations

from msb_extractor.parser.calendar import parse_set_text


def test_basic_load_and_percent() -> None:
    s = parse_set_text("1 x 8 Reps @ 152.5 kg (68%)")
    assert s.sets == 1
    assert s.reps == 8
    assert s.load_kg == 152.5
    assert s.load_display == "152.5 kg"
    assert s.percent_1rm is not None
    assert abs(s.percent_1rm - 0.68) < 1e-9
    assert s.target_text == "1 x 8 Reps @ 152.5 kg (68%)"


def test_rpe_target() -> None:
    s = parse_set_text("1 x 3 Reps @ RPE5")
    assert s.sets == 1
    assert s.reps == 3
    assert s.rpe == 5.0
    assert s.load_kg is None


def test_spaced_rpe() -> None:
    s = parse_set_text("3 x 10 Reps @ RPE 8")
    assert s.sets == 3
    assert s.reps == 10
    assert s.rpe == 8.0


def test_amrap_keeps_text() -> None:
    s = parse_set_text("1 x AMRAP @ 60%")
    assert s.sets == 1
    assert s.reps is None
    assert s.reps_text is not None
    assert "AMRAP" in s.reps_text
    assert s.percent_1rm is not None
    assert abs(s.percent_1rm - 0.60) < 1e-9


def test_bare_percentage_without_parentheses() -> None:
    s = parse_set_text("1 x 5 Reps @ 80%")
    assert s.percent_1rm is not None
    assert abs(s.percent_1rm - 0.80) < 1e-9


def test_lbs_source_converts_to_kg_and_preserves_display() -> None:
    """Lbs-origin prescriptions round-trip through kg storage.

    The parser stores the canonical kg value so the --units flag can
    display either unit, and preserves the original lbs string in
    ``load_display`` / ``target_text`` for anyone inspecting the raw
    prescription verbatim.
    """
    s = parse_set_text("1 x 8 Reps @ 185 lbs")
    assert s.load_kg is not None
    assert abs(s.load_kg - 185 * 0.45359237) < 1e-9
    assert s.load_display == "185.0 lbs"
