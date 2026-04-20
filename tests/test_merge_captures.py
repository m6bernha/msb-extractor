"""Tests for the ``tools.merge_captures`` CLI."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from tools.merge_captures import app, merge_captures
from typer.testing import CliRunner

from msb_extractor.models import Capture

runner = CliRunner()


# Synthetic HTML fragments. The real MSB HTML is much larger and is never
# checked in (see CONTRIBUTING.md); the merge logic only cares about whether
# the ``data-full-comment`` marker is present.
CAL_HTML_MAR = "<div class='cal'>March 2025</div>"
CAL_HTML_APR = "<div class='cal'>April 2025</div>"
DAY_HTML_PLAIN = "<div class='day'>Set: 100kg x 5</div>"
DAY_HTML_PLAIN_V2 = "<div class='day'>Set: 102.5kg x 5</div>"
DAY_HTML_ENRICHED = (
    "<div class='day' data-full-comment=\"elbows slotted, felt strong\">Set: 100kg x 5</div>"
)


def _base(**overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "schemaVersion": 1,
        "capturedAt": "2026-04-17T20:00:00Z",
        "source": "app.mystrengthbook.com",
        "calendars": {},
        "days": {},
    }
    payload.update(overrides)
    return payload


def _write(path: Path, data: dict[str, Any]) -> Path:
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def test_basic_merge_non_overlapping(tmp_path: Path) -> None:
    a = _write(
        tmp_path / "a.json",
        _base(
            calendars={"2025-03": CAL_HTML_MAR},
            days={"2025-03-01": DAY_HTML_PLAIN},
        ),
    )
    b = _write(
        tmp_path / "b.json",
        _base(
            calendars={"2025-04": CAL_HTML_APR},
            days={"2025-04-01": DAY_HTML_PLAIN},
        ),
    )
    out = tmp_path / "merged.json"

    result = runner.invoke(app, [str(a), str(b), "--output", str(out)])

    assert result.exit_code == 0, result.output
    merged = json.loads(out.read_text(encoding="utf-8"))
    assert set(merged["calendars"]) == {"2025-03", "2025-04"}
    assert set(merged["days"]) == {"2025-03-01", "2025-04-01"}
    assert merged["calendars"]["2025-03"] == CAL_HTML_MAR
    assert merged["days"]["2025-04-01"] == DAY_HTML_PLAIN


def test_later_wins_on_plain_day_conflict(tmp_path: Path) -> None:
    a = _write(tmp_path / "a.json", _base(days={"2025-03-01": DAY_HTML_PLAIN}))
    b = _write(tmp_path / "b.json", _base(days={"2025-03-01": DAY_HTML_PLAIN_V2}))
    out = tmp_path / "merged.json"

    result = runner.invoke(app, [str(a), str(b), "--output", str(out)])

    assert result.exit_code == 0, result.output
    merged = json.loads(out.read_text(encoding="utf-8"))
    assert merged["days"]["2025-03-01"] == DAY_HTML_PLAIN_V2
    output_norm = " ".join(result.output.split())
    assert "1 conflicts resolved by recency" in output_norm
    assert "0 by enrichment" in output_norm


def test_enrichment_wins_even_when_earlier(tmp_path: Path) -> None:
    # Earlier input has the enriched (full-comment) HTML; later input is plain.
    # The enriched version must win regardless of argument order.
    a = _write(tmp_path / "a.json", _base(days={"2025-03-01": DAY_HTML_ENRICHED}))
    b = _write(tmp_path / "b.json", _base(days={"2025-03-01": DAY_HTML_PLAIN}))
    out = tmp_path / "merged.json"

    result = runner.invoke(app, [str(a), str(b), "--output", str(out)])

    assert result.exit_code == 0, result.output
    merged = json.loads(out.read_text(encoding="utf-8"))
    assert merged["days"]["2025-03-01"] == DAY_HTML_ENRICHED
    output_norm = " ".join(result.output.split())
    assert "1 by enrichment" in output_norm


def test_schema_version_propagates_as_max(tmp_path: Path) -> None:
    a = _write(tmp_path / "a.json", _base(schemaVersion=1))
    b = _write(tmp_path / "b.json", _base(schemaVersion=3))
    c = _write(tmp_path / "c.json", _base(schemaVersion=2))
    out = tmp_path / "merged.json"

    result = runner.invoke(app, [str(a), str(b), str(c), "--output", str(out)])

    assert result.exit_code == 0, result.output
    merged = json.loads(out.read_text(encoding="utf-8"))
    assert merged["schemaVersion"] == 3


def test_invalid_json_rejected(tmp_path: Path) -> None:
    bad = tmp_path / "bad.json"
    bad.write_text("{not: valid json", encoding="utf-8")
    out = tmp_path / "merged.json"

    result = runner.invoke(app, [str(bad), "--output", str(out)])

    assert result.exit_code != 0
    assert not out.exists()
    # The error must be routed through typer.BadParameter, which surfaces
    # a usage error rather than a raw traceback. An uncaught exception
    # would leave result.exception populated with the original error.
    assert not isinstance(result.exception, json.JSONDecodeError)


def test_merge_captures_pure_function_enrichment() -> None:
    # Unit-level sanity check on the pure merge function: enrichment rule
    # is symmetric — it holds whether the enriched capture is first or last.
    enriched = Capture.model_validate(_base(days={"2025-03-01": DAY_HTML_ENRICHED}))
    plain = Capture.model_validate(_base(days={"2025-03-01": DAY_HTML_PLAIN}))

    merged_first, stats_first = merge_captures([enriched, plain])
    merged_last, stats_last = merge_captures([plain, enriched])

    assert merged_first.days["2025-03-01"] == DAY_HTML_ENRICHED
    assert merged_last.days["2025-03-01"] == DAY_HTML_ENRICHED
    assert stats_first.enrichment_conflicts == 1
    assert stats_last.enrichment_conflicts == 1
    assert stats_first.recency_conflicts == 0
    assert stats_last.recency_conflicts == 0
