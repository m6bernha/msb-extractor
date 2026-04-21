"""End-to-end capture parsing: calendar + day-detail merged."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from msb_extractor.models import DataSource
from msb_extractor.parser.capture import (
    CaptureFileError,
    parse_capture,
    parse_capture_file,
)


def test_parse_capture_merges_sources(capture_json: dict[str, Any]) -> None:
    result = parse_capture(capture_json)
    assert len(result.days) == 2

    by_date = {d.date.isoformat(): d for d in result.days}
    assert by_date["2025-03-29"].data_source == DataSource.FULL_DETAIL
    assert by_date["2025-03-31"].data_source == DataSource.CALENDAR


def test_parse_capture_full_detail_has_actuals(capture_json: dict[str, Any]) -> None:
    result = parse_capture(capture_json)
    day = next(d for d in result.days if d.data_source == DataSource.FULL_DETAIL)
    bench = next(ex for ex in day.exercises if ex.name == "Competition (bench)")
    assert len(bench.actuals) == 2


def test_parse_capture_file_reads_json(capture_file: Path) -> None:
    result = parse_capture_file(capture_file)
    assert len(result.days) == 2
    assert result.source == "app.mystrengthbook.com"
    assert result.total_sets > 0


def test_parse_capture_file_missing_raises_user_error(tmp_path: Path) -> None:
    missing = tmp_path / "nope.json"
    with pytest.raises(CaptureFileError) as exc_info:
        parse_capture_file(missing)
    assert "not found" in str(exc_info.value).lower()


def test_parse_capture_file_malformed_raises_user_error(tmp_path: Path) -> None:
    bad = tmp_path / "bad.json"
    bad.write_text("{not valid json", encoding="utf-8")
    with pytest.raises(CaptureFileError) as exc_info:
        parse_capture_file(bad)
    message = str(exc_info.value)
    assert "not valid JSON" in message
    assert "line" in message
