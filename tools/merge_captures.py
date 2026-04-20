"""Merge multiple MSB capture JSONs into a single file.

Typical use: an initial full-history scrape followed by one or more targeted
re-runs to fill gaps (a month the scraper missed, a week that needed the
comment-expansion pass, etc.). The merged output is drop-in compatible
with ``msb-extractor parse`` — no downstream changes required.

Merge rules
-----------
- ``calendars`` and ``days`` from every input are merged by key.
- Generic conflict: later inputs win.
- Per-day exception: if any input holds an "enriched" day HTML (contains
  the ``data-full-comment=`` marker the scraper's expansion pass writes)
  and another holds the same day without it, the enriched version wins
  regardless of argument order — losing comment detail to a later,
  shallower re-run would defeat the purpose of merging.
- ``schemaVersion`` and ``capturedAt`` are the maximum across all inputs.
- ``source`` is taken from the first input (they should all match).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated

import typer
from pydantic import ValidationError
from rich.console import Console

from msb_extractor.models import Capture

ENRICHMENT_MARKER = "data-full-comment="

app = typer.Typer(
    name="merge-captures",
    help=(
        "Stitch multiple msb_capture.json files into one. Later inputs win on"
        " plain conflicts; enriched day HTML always wins regardless of order."
    ),
    no_args_is_help=True,
    add_completion=False,
)

_console = Console()


@dataclass(frozen=True)
class MergeStats:
    """Counts surfaced in the CLI summary line."""

    calendars: int
    days: int
    recency_conflicts: int
    enrichment_conflicts: int


def _is_enriched(html: str) -> bool:
    return ENRICHMENT_MARKER in html


def merge_captures(captures: list[Capture]) -> tuple[Capture, MergeStats]:
    """Merge a list of captures in order. See module docstring for rules."""
    if not captures:
        raise ValueError("merge_captures requires at least one capture")

    merged_calendars: dict[str, str] = {}
    merged_days: dict[str, str] = {}
    recency = 0
    enrichment = 0

    for cap in captures:
        for key, html in cap.calendars.items():
            if key in merged_calendars:
                recency += 1
            merged_calendars[key] = html

        for key, html in cap.days.items():
            current = merged_days.get(key)
            if current is None:
                merged_days[key] = html
                continue
            new_enriched = _is_enriched(html)
            cur_enriched = _is_enriched(current)
            if new_enriched and not cur_enriched:
                merged_days[key] = html
                enrichment += 1
            elif cur_enriched and not new_enriched:
                enrichment += 1
            else:
                merged_days[key] = html
                recency += 1

    schema_version = max(c.schema_version for c in captures)
    captured_times = [c.captured_at for c in captures if c.captured_at is not None]
    captured_at = max(captured_times) if captured_times else None

    merged = Capture(
        schema_version=schema_version,
        captured_at=captured_at,
        source=captures[0].source,
        calendars=merged_calendars,
        days=merged_days,
    )
    stats = MergeStats(
        calendars=len(merged_calendars),
        days=len(merged_days),
        recency_conflicts=recency,
        enrichment_conflicts=enrichment,
    )
    return merged, stats


def _load_capture(path: Path) -> Capture:
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise typer.BadParameter(f"Cannot read {path}: {exc}") from exc
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise typer.BadParameter(
            f"{path.name} is not valid JSON: {exc.msg} (line {exc.lineno}, col {exc.colno})"
        ) from exc
    try:
        return Capture.model_validate(data)
    except ValidationError as exc:
        raise typer.BadParameter(
            f"{path.name} does not match the capture schema: {exc.error_count()} error(s)"
        ) from exc


@app.command()
def merge(
    inputs: Annotated[
        list[Path],
        typer.Argument(
            exists=True,
            dir_okay=False,
            readable=True,
            resolve_path=True,
            metavar="INPUT.json ...",
            help="Capture JSON files to merge. Later inputs win on plain conflicts.",
        ),
    ],
    output: Annotated[
        Path,
        typer.Option(
            "--output",
            "-o",
            help="Where to write the merged capture JSON.",
        ),
    ],
) -> None:
    """Merge capture JSONs into a single file."""
    captures = [_load_capture(p) for p in inputs]
    merged, stats = merge_captures(captures)

    output.write_text(
        merged.model_dump_json(by_alias=True, indent=2),
        encoding="utf-8",
    )

    _console.print(
        f"Merged {len(captures)} inputs -> "
        f"{stats.calendars} calendars, {stats.days} days "
        f"({stats.recency_conflicts} conflicts resolved by recency, "
        f"{stats.enrichment_conflicts} by enrichment)."
    )
    _console.print(f"Wrote [cyan]{output}[/cyan]")


if __name__ == "__main__":
    app()
