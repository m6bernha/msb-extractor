"""Parse MSB's /api/v1/exercise JSON responses into domain models.

Starting with schemaVersion 4, the scraper skips HTML scraping entirely
and captures per-month JSON responses from ``app-us.mystrengthbook.com/api/v1/exercise``.
This module converts that raw JSON into the same ``TrainingDay`` / ``Exercise``
/ ``ActualSet`` shape the HTML parser produces, so exporters downstream do
not need to know which capture path was used.

The exact field names inside each exercise and each set are not yet
documented by MSB, so the parser is defensive: it accepts several
common names for the same logical field (``load`` vs ``weight``,
``actualReps`` vs ``reps``, ``notes`` vs ``comment`` vs ``description``).
If a real capture reveals a field name we do not handle, add it to the
candidate list in the corresponding ``_first_of`` call rather than
rewriting the shape.
"""

from __future__ import annotations

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
    for i, s in enumerate(sets_list):
        if not isinstance(s, dict):
            continue
        p = _parse_prescribed_set(s)
        if p is not None:
            prescribed.append(p)
        a = _parse_actual_set(s, i)
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
    rpe = _float_or_none(_first_of(s, "rpePrescribed", "prescribedRpe", "targetRpe", "rpe"))
    load = _float_or_none(
        _first_of(s, "loadPrescribed", "prescribedLoad", "targetLoad", "load", "weight")
    )
    pct = _float_or_none(_first_of(s, "percentage", "percent", "percent1rm", "percentageOf1rm"))
    if pct is not None and pct > 1.5:
        pct = pct / 100.0
    if reps is None and rpe is None and load is None and pct is None:
        return None
    return PrescribedSet(
        reps=reps,
        rpe=rpe,
        percent_1rm=pct,
        load_kg=load,
        load_display=f"{load} kg" if load is not None else None,
        target_text=_describe_prescribed(reps, rpe, load, pct),
        status=SetStatus.PRESCRIBED,
    )


def _describe_prescribed(
    reps: int | None, rpe: float | None, load: float | None, pct: float | None
) -> str:
    parts: list[str] = []
    if reps is not None:
        parts.append(f"{reps} reps")
    if load is not None:
        parts.append(f"@ {load} kg")
    elif pct is not None:
        parts.append(f"@ {round(pct * 100)}%")
    if rpe is not None:
        parts.append(f"RPE {rpe:g}")
    return " ".join(parts)


def _parse_actual_set(s: dict[str, Any], index: int) -> ActualSet | None:
    reps = _int_or_none(
        _first_of(s, "actualReps", "performedReps", "completedReps", "repsDone", "reps")
    )
    load = _float_or_none(
        _first_of(
            s,
            "actualLoad",
            "performedLoad",
            "actualWeight",
            "performedWeight",
            "loadDone",
            "load",
            "weight",
        )
    )
    rpe = _float_or_none(_first_of(s, "actualRpe", "performedRpe", "rpe"))
    e1rm = _float_or_none(_first_of(s, "e1rm", "estimated1rm", "estimatedOneRepMax"))
    pct = _float_or_none(_first_of(s, "percentOfMax", "percentage", "percent", "percent1rm"))
    if pct is not None and pct > 1.5:
        pct = pct / 100.0
    comment = _str_or_none(
        _first_of(s, "notes", "comment", "description", "lifterNotes", "athleteNotes")
    )
    video = _video_url(s.get("video") or s.get("videos") or s.get("media"))

    complete_flag = s.get("complete")
    if complete_flag is None:
        complete_flag = s.get("completed")
    status = SetStatus.UNKNOWN
    if complete_flag is True:
        status = SetStatus.COMPLETED
    elif complete_flag is False and (reps is not None or load is not None):
        status = SetStatus.PARTIAL

    # Only materialise an actual set if the lifter logged *something* for it.
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
        set_number=index + 1,
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


def _video_url(v: Any) -> str | None:
    if v is None:
        return None
    if isinstance(v, str) and v.strip():
        return v.strip()
    if isinstance(v, dict):
        for key in ("url", "href", "src", "originalId"):
            val = v.get(key)
            if isinstance(val, str) and val.strip():
                return val.strip()
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
