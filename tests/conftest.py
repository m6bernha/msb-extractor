"""Shared pytest fixtures."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def calendar_html() -> str:
    return (FIXTURES / "calendar_sample.html").read_text(encoding="utf-8")


@pytest.fixture
def day_detail_html() -> str:
    return (FIXTURES / "day_detail_sample.html").read_text(encoding="utf-8")


@pytest.fixture
def capture_json(calendar_html: str, day_detail_html: str) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "capturedAt": "2026-04-17T20:00:00Z",
        "source": "app.mystrengthbook.com",
        "calendars": {"2025-03": calendar_html},
        "days": {"2025-03-29": day_detail_html},
    }


@pytest.fixture
def capture_file(tmp_path: Path, capture_json: dict[str, Any]) -> Path:
    path = tmp_path / "capture.json"
    path.write_text(json.dumps(capture_json), encoding="utf-8")
    return path
