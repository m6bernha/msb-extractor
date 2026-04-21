"""Coordinate calendar + day-detail parsers against a Capture JSON payload."""

from __future__ import annotations

import json
from datetime import date as date_type
from pathlib import Path
from typing import Any

from msb_extractor.models import Capture, DataSource, ParseResult, TrainingDay
from msb_extractor.parser.api import parse_api_months
from msb_extractor.parser.calendar import parse_calendar_html
from msb_extractor.parser.day_detail import parse_day_detail_html


class CaptureFileError(ValueError):
    """Raised when a capture JSON cannot be loaded or parsed.

    Surfaces a single, user-readable message; the CLI catches this and
    prints it without a traceback so non-technical users get actionable
    feedback on the most common first-run failures (missing file, wrong
    path, file that is not valid JSON).
    """


def parse_capture_file(path: str | Path) -> ParseResult:
    """Load a ``msb_capture.json`` file and parse it into a ``ParseResult``.

    Raises :class:`CaptureFileError` with a user-facing message on any
    filesystem or JSON decoding failure. All other exceptions propagate.
    """
    p = Path(path)
    try:
        raw = p.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise CaptureFileError(f"Capture file not found: {p}") from exc
    except OSError as exc:
        raise CaptureFileError(f"Cannot read {p}: {exc.strerror or exc}") from exc
    try:
        data: Any = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise CaptureFileError(
            f"{p.name} is not valid JSON: {exc.msg} "
            f"(line {exc.lineno}, column {exc.colno}). "
            f"Did you point at the right file? The scraper writes "
            f"'msb_capture.json'; a partial download may be truncated."
        ) from exc
    return parse_capture(data)


def parse_capture(data: dict[str, Any] | Capture) -> ParseResult:
    """Parse an in-memory capture payload into a ``ParseResult``.

    When a training day is present in both ``calendars`` and ``days``, the
    day-detail parse wins because it carries actuals, comments, and e1RM.
    Days that appear only in ``calendars`` are preserved at the calendar
    (prescription) level of detail.
    """
    capture = data if isinstance(data, Capture) else Capture.model_validate(data)

    # v4 captures ship API JSON instead of raw HTML. Route them through the
    # API parser and return early — there's no HTML to merge.
    if capture.api_months:
        return ParseResult(
            days=parse_api_months(capture.api_months),
            captured_at=capture.captured_at,
            source=capture.source,
            api_probes=capture.api_probes,
        )

    calendar_days: dict[date_type, TrainingDay] = {}
    for html in capture.calendars.values():
        for cal_day in parse_calendar_html(html):
            # Last writer wins per date in case of duplicates.
            calendar_days[cal_day.date] = cal_day

    detail_days: dict[date_type, TrainingDay] = {}
    for date_str, html in capture.days.items():
        detail_day = parse_day_detail_html(html, date_str)
        if detail_day is not None:
            detail_days[detail_day.date] = detail_day

    # Merge: detail overrides calendar; calendar fills gaps.
    merged: dict[date_type, TrainingDay] = dict(calendar_days)
    merged.update(detail_days)

    # Enrich: for detail days, copy any useful prescribed-set hints from the
    # matching calendar day into detail exercises that lack them.
    for d, detail_entry in detail_days.items():
        cal_entry = calendar_days.get(d)
        if cal_entry is None:
            continue
        merged[d] = _enrich_detail_with_calendar(detail_entry, cal_entry)

    days = [merged[d] for d in sorted(merged.keys())]

    return ParseResult(
        days=days,
        captured_at=capture.captured_at,
        source=capture.source,
    )


def _enrich_detail_with_calendar(
    detail: TrainingDay,
    calendar: TrainingDay,
) -> TrainingDay:
    """Attach calendar-level prescription info to detail exercises that are missing it.

    Day-detail HTML sometimes omits prescription entries the calendar view does
    show (for example, a warm-up block that isn't tracked in actuals). When an
    exercise appears only in the calendar copy, we surface it in the output so
    users see the full prescription even where actuals are absent.
    """
    detail_names = {ex.name.casefold() for ex in detail.exercises}
    extras = [ex for ex in calendar.exercises if ex.name.casefold() not in detail_names]
    if not extras:
        return detail
    return detail.model_copy(
        update={
            "exercises": [*detail.exercises, *extras],
            "data_source": DataSource.FULL_DETAIL,
        }
    )
