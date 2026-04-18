"""Tests for the normalize package (units, rename map, week grouping)."""

from __future__ import annotations

from datetime import date
from pathlib import Path

from msb_extractor.models import DataSource, Exercise, TrainingDay
from msb_extractor.normalize.exercise import apply_rename, load_rename_map
from msb_extractor.normalize.program import group_by_week, iso_week_start
from msb_extractor.normalize.units import format_load, kg_to_lbs, lbs_to_kg


def test_kg_lbs_roundtrip() -> None:
    assert round(kg_to_lbs(100), 3) == 220.462
    assert round(lbs_to_kg(220.462), 2) == 100.00


def test_format_load_kg() -> None:
    assert format_load(100.0, "kg") == "100.0 kg"


def test_format_load_lbs_rounds() -> None:
    assert format_load(100.0, "lbs", decimals=0) == "220 lbs"


def test_format_load_none() -> None:
    assert format_load(None, "kg") is None


def test_apply_rename_passthrough_empty_map() -> None:
    assert apply_rename("Competition (bench)", {}) == "Competition (bench)"


def test_apply_rename_hit() -> None:
    m = {"Competition (bench)": "Flat Barbell Bench Press"}
    assert apply_rename("Competition (bench)", m) == "Flat Barbell Bench Press"


def test_load_rename_map_missing_file_returns_empty(tmp_path: Path) -> None:
    assert load_rename_map(tmp_path / "nope.yaml") == {}


def test_load_rename_map_reads_yaml(tmp_path: Path) -> None:
    path = tmp_path / "rename.yaml"
    path.write_text('"Competition (bench)": "Bench"\n', encoding="utf-8")
    assert load_rename_map(path) == {"Competition (bench)": "Bench"}


def test_iso_week_start_on_saturday() -> None:
    # 2025-03-29 is a Saturday -> Monday 2025-03-24
    assert iso_week_start(date(2025, 3, 29)) == date(2025, 3, 24)


def test_iso_week_start_on_monday_is_self() -> None:
    assert iso_week_start(date(2025, 3, 24)) == date(2025, 3, 24)


def test_group_by_week_buckets_correctly() -> None:
    days = [
        TrainingDay(
            date=date(2025, 3, 25),
            exercises=[Exercise(name="A")],
            data_source=DataSource.CALENDAR,
        ),
        TrainingDay(
            date=date(2025, 3, 31),
            exercises=[Exercise(name="A")],
            data_source=DataSource.CALENDAR,
        ),
        TrainingDay(
            date=date(2025, 3, 27),
            exercises=[Exercise(name="A")],
            data_source=DataSource.CALENDAR,
        ),
    ]
    groups = group_by_week(days)
    assert list(groups.keys()) == [date(2025, 3, 24), date(2025, 3, 31)]
    assert len(groups[date(2025, 3, 24)]) == 2
    assert groups[date(2025, 3, 24)][0].date < groups[date(2025, 3, 24)][1].date
