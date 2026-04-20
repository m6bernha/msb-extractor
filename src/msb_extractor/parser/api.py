"""Parse MSB's /api/v1/exercise JSON responses into domain models.

Starting with schemaVersion 4, the scraper skips HTML scraping entirely
and captures per-month JSON responses from ``app-us.mystrengthbook.com/api/v1/exercise``.
This module converts that raw JSON into the same ``TrainingDay`` / ``Exercise``
/ ``ActualSet`` shape the HTML parser produces, so exporters downstream do
not need to know which capture path was used.

MSB response shape (verified against a real capture, April 2026):

    exercise = {
      _id, primary, secondary, customName, order, utcDate, date, notes,
      sets: [
        {
          sets: 3, reps: 12, rpe: 7, load: 40.0, percentRepMax: 0,   # prescription
          zone: "deload", equipped: false, repsLower: 10,
          outcomes: {                                                # performed
            "0": {status: "completed", outcome: {reps, load, rpe, e1rm, sets}},
            "1": {status: "completed", outcome: {...}},
            ...
          },
          comments: {"0": "free-text comment for set 0", ...},       # per-outcome
          videos: {...}
        }, ...
      ]
    }

One entry in ``sets[]`` is a *prescription group* ("do 3 sets of 12 @ 40 kg").
Each key in that entry's ``outcomes`` dict is one actually-performed set.
Comments are keyed by the same outcome index. The parser therefore emits
one ``ActualSet`` per outcome, not one per entry.

The ``_first_of`` helper still accepts synonyms so mildly different shapes
on other endpoints don't immediately break parsing.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import date as date_type
from datetime import datetime
from typing import Any

from msb_extractor.models import (
    ActualSet,
    DataSource,
    Exercise,
    PrescribedSet,
    SetStatus,
    TrainingDay,
)


def parse_api_months(api_months: dict[str, Any]) -> list[TrainingDay]:
    """Fold every exercise across every month into TrainingDay objects.

    Sorted by calendar date. Within a day, exercises are sorted by the
    numeric ``order`` MSB assigns (1, 2, 3 → A, B, C).
    """
    by_date: dict[date_type, list[tuple[int, Exercise]]] = {}
    for raw in api_months.values():
        for item in _extract_list(raw):
            if not isinstance(item, dict):
                continue
            d = _extract_date(item)
            if d is None:
                continue
            ex = _parse_exercise(item)
            if ex is None:
                continue
            order_num = _int_or_none(item.get("order")) or 999
            by_date.setdefault(d, []).append((order_num, ex))

    days: list[TrainingDay] = []
    for d in sorted(by_date.keys()):
        ordered = sorted(by_date[d], key=lambda pair: pair[0])
        days.append(
            TrainingDay(
                date=d,
                exercises=[ex for _, ex in ordered],
                data_source=DataSource.FULL_DETAIL,
            )
        )
    return days


def _extract_list(raw: Any) -> list[Any]:
    if isinstance(raw, list):
        return raw
    if isinstance(raw, dict):
        for key in ("docs", "data", "items", "results"):
            val = raw.get(key)
            if isinstance(val, list):
                return val
    return []


def _extract_date(item: dict[str, Any]) -> date_type | None:
    utc = item.get("utcDate")
    if utc is not None:
        s = str(utc).strip()
        if len(s) == 8 and s.isdigit():
            try:
                return date_type(int(s[0:4]), int(s[4:6]), int(s[6:8]))
            except ValueError:
                pass
    d = item.get("date")
    if d is not None:
        s = str(d).strip()
        try:
            return datetime.fromisoformat(s.replace("Z", "+00:00")).date()
        except ValueError:
            pass
        if len(s) >= 10:
            try:
                return date_type(int(s[0:4]), int(s[5:7]), int(s[8:10]))
            except ValueError:
                pass
    return None


def _parse_exercise(item: dict[str, Any]) -> Exercise | None:
    name = _exercise_name(item)
    if not name:
        return None
    order_letter = _order_letter(item.get("order"))
    raw_sets = item.get("sets")
    sets_list = raw_sets if isinstance(raw_sets, list) else []

    prescribed: list[PrescribedSet] = []
    actuals: list[ActualSet] = []
    set_counter = 0
    for entry in sets_list:
        if not isinstance(entry, dict):
            continue
        p = _parse_prescribed_set(entry)
        if p is not None:
            prescribed.append(p)
        for outcome_key, outcome in _iter_outcomes(entry):
            set_counter += 1
            a = _parse_actual_from_outcome(entry, outcome, outcome_key, set_counter)
            if a is not None:
                actuals.append(a)

    return Exercise(
        order=order_letter,
        name=name,
        prescribed=prescribed,
        actuals=actuals,
        notes=_str_or_none(item.get("notes")),
    )


def _exercise_name(item: dict[str, Any]) -> str:
    custom = _str_or_none(item.get("customName"))
    if custom:
        return custom
    primary = _str_or_none(item.get("primary")) or ""
    secondary = _str_or_none(item.get("secondary")) or ""
    if primary and secondary:
        # Match the human-readable form MSB's HTML also produces.
        return f"{secondary} ({primary})"
    return primary or secondary or ""


def _order_letter(order: Any) -> str:
    n = _int_or_none(order)
    if n is not None and 1 <= n <= 26:
        return chr(ord("A") + n - 1)
    return ""


def _first_of(d: dict[str, Any], *keys: str) -> Any:
    """Return the first non-None value for any of the given keys."""
    for k in keys:
        v = d.get(k)
        if v is not None and v != "":
            return v
    return None


def _parse_prescribed_set(s: dict[str, Any]) -> PrescribedSet | None:
    reps = _int_or_none(_first_of(s, "repsPrescribed", "prescribedReps", "targetReps", "reps"))
    reps_lower = _int_or_none(s.get("repsLower"))
    rpe = _float_or_none(_first_of(s, "rpePrescribed", "prescribedRpe", "targetRpe", "rpe"))
    load = _float_or_none(
        _first_of(s, "loadPrescribed", "prescribedLoad", "targetLoad", "load", "weight")
    )
    pct = _float_or_none(
        _first_of(s, "percentRepMax", "percentage", "percent", "percent1rm", "percentageOf1rm")
    )
    if pct is not None and pct > 1.5:
        pct = pct / 100.0
    sets_count = _int_or_none(s.get("sets"))
    reps_text: str | None = None
    if reps_lower is not None and reps is not None and reps_lower != reps:
        lower, upper = sorted((reps_lower, reps))
        reps_text = f"{lower}-{upper}"
    if reps is None and rpe is None and load is None and pct is None and not sets_count:
        return None
    return PrescribedSet(
        sets=sets_count,
        reps=reps,
        reps_text=reps_text,
        rpe=rpe,
        percent_1rm=pct,
        load_kg=load,
        load_display=f"{load} kg" if load is not None else None,
        target_text=_describe_prescribed(reps, rpe, load, pct, sets_count, reps_text),
        status=SetStatus.PRESCRIBED,
    )


def _describe_prescribed(
    reps: int | None,
    rpe: float | None,
    load: float | None,
    pct: float | None,
    sets: int | None = None,
    reps_text: str | None = None,
) -> str:
    parts: list[str] = []
    rep_part = reps_text or (str(reps) if reps is not None else None)
    if sets and sets > 1 and rep_part:
        parts.append(f"{sets}x{rep_part}")
    elif rep_part:
        parts.append(f"{rep_part} reps")
    if load is not None and load > 0:
        parts.append(f"@ {load} kg")
    elif pct is not None and pct > 0:
        parts.append(f"@ {round(pct * 100)}%")
    if rpe is not None:
        parts.append(f"RPE {rpe:g}")
    return " ".join(parts)


def _iter_outcomes(entry: dict[str, Any]) -> Iterator[tuple[str, dict[str, Any]]]:
    """Yield ``(key, outcome_dict)`` in ascending numeric-key order.

    MSB ships outcomes as ``{"0": {...}, "1": {...}}`` (a dict keyed by a
    stringified integer). Older/alternate shapes may use a list; handle
    both without changing call-sites.
    """
    raw = entry.get("outcomes")
    if isinstance(raw, dict):
        pairs: list[tuple[int, str, dict[str, Any]]] = []
        for k, v in raw.items():
            if not isinstance(v, dict):
                continue
            try:
                order_key = int(str(k))
            except (TypeError, ValueError):
                order_key = 0
            pairs.append((order_key, str(k), v))
        pairs.sort()
        for _, key, val in pairs:
            yield key, val
    elif isinstance(raw, list):
        for i, v in enumerate(raw):
            if isinstance(v, dict):
                yield str(i), v


def _parse_actual_from_outcome(
    entry: dict[str, Any],
    outcome: dict[str, Any],
    outcome_key: str,
    set_number: int,
) -> ActualSet | None:
    inner_raw = outcome.get("outcome")
    inner: dict[str, Any] = inner_raw if isinstance(inner_raw, dict) else outcome

    reps = _int_or_none(
        _first_of(inner, "actualReps", "performedReps", "completedReps", "repsDone", "reps")
    )
    load = _float_or_none(
        _first_of(
            inner,
            "actualLoad",
            "performedLoad",
            "actualWeight",
            "performedWeight",
            "loadDone",
            "load",
            "weight",
        )
    )
    rpe = _float_or_none(_first_of(inner, "actualRpe", "performedRpe", "rpe"))
    e1rm = _float_or_none(_first_of(inner, "e1rm", "estimated1rm", "estimatedOneRepMax"))
    pct = _float_or_none(
        _first_of(inner, "percentOfMax", "percentage", "percent", "percent1rm", "percentRepMax")
    )
    if pct is not None and pct > 1.5:
        pct = pct / 100.0

    comment = _comment_for(entry, outcome_key)
    video = _video_url(
        inner.get("video") or inner.get("videos") or entry.get("videos") or entry.get("video")
    )
    status = _status_from_outcome(outcome, reps=reps, load=load)

    if (
        reps is None
        and load is None
        and rpe is None
        and e1rm is None
        and not comment
        and video is None
    ):
        return None

    return ActualSet(
        set_number=set_number,
        reps=reps,
        rpe=rpe,
        load_kg=load,
        load_display=f"{load} kg" if load is not None else None,
        percent_1rm=pct,
        e1rm_kg=e1rm,
        comment=comment,
        video_url=video,
        status=status,
    )


def _comment_for(entry: dict[str, Any], key: str) -> str | None:
    raw = entry.get("comments")
    if isinstance(raw, dict):
        val = raw.get(key)
        if val is None:
            try:
                val = raw.get(int(key))
            except (TypeError, ValueError):
                val = None
        return _str_or_none(val)
    if isinstance(raw, list):
        try:
            idx = int(key)
        except (TypeError, ValueError):
            return None
        if 0 <= idx < len(raw):
            return _str_or_none(raw[idx])
    if isinstance(raw, str):
        return _str_or_none(raw)
    return None


def _status_from_outcome(
    outcome: dict[str, Any], *, reps: int | None, load: float | None
) -> SetStatus:
    raw = str(outcome.get("status") or "").lower()
    if raw == "completed":
        return SetStatus.COMPLETED
    if raw in {"missed", "failed", "skipped"}:
        return SetStatus.MISSED
    if raw in {"partial", "incomplete"}:
        return SetStatus.PARTIAL
    if reps is not None or load is not None:
        return SetStatus.COMPLETED
    return SetStatus.UNKNOWN


def _video_url(v: Any) -> str | None:
    if v is None:
        return None
    if isinstance(v, str) and v.strip():
        return v.strip()
    if isinstance(v, dict):
        for key in ("url", "href", "src", "originalId", "videoOriginal"):
            val = v.get(key)
            if isinstance(val, str) and val.strip():
                return val.strip()
        # MSB nests by outcome index: {"0": {"videoOriginal": "...mp4"}}.
        for val in v.values():
            if isinstance(val, dict):
                nested = _video_url(val)
                if nested:
                    return nested
    if isinstance(v, list) and v:
        first = v[0]
        if isinstance(first, str):
            return first
        if isinstance(first, dict):
            return _video_url(first)
    return None


def _int_or_none(x: Any) -> int | None:
    if x is None or x == "":
        return None
    try:
        return int(x)
    except (TypeError, ValueError):
        try:
            return int(float(x))
        except (TypeError, ValueError):
            return None


def _float_or_none(x: Any) -> float | None:
    if x is None or x == "":
        return None
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def _str_or_none(x: Any) -> str | None:
    if x is None:
        return None
    s = str(x).strip()
    return s or None
