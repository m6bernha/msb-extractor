"""Parse calendar-month HTML from MSB into structured TrainingDay objects.

The calendar view gives us:
- the date of every training day in the month
- each exercise (letter-prefixed: A, B, C...)
- each prescribed set, with a completion-dot colour indicating status
- for percentage-based prescriptions: the computed load in kg

What it does NOT give us (that day-detail does):
- the lifter's actual reps / RPE / load on RPE-based prescriptions
- per-set comments
- estimated 1RM
- video links
"""

from __future__ import annotations

import re
from datetime import date as date_type

from bs4 import BeautifulSoup, Tag

from msb_extractor.models import (
    DataSource,
    Exercise,
    PrescribedSet,
    SetStatus,
    TrainingDay,
)

_DATE_RE = re.compile(r'id="select-(\d{4}-\d{2}-\d{2})"')
_SET_TEXT_RE = re.compile(
    r"(?P<sets>\d+)\s*x\s*(?P<reps>[\w\s]+?)(?:\s*Reps?\b)?(?:\s*@\s*(?P<at>.+))?$",
    re.IGNORECASE,
)
_LOAD_KG_RE = re.compile(r"(\d+(?:\.\d+)?)\s*kg", re.IGNORECASE)
_LOAD_LBS_RE = re.compile(r"(\d+(?:\.\d+)?)\s*lbs?", re.IGNORECASE)
_PCT_RE = re.compile(r"\((\d+(?:\.\d+)?)\s*%\)|(\d+(?:\.\d+)?)\s*%")
_RPE_RE = re.compile(r"RPE\s*(\d+(?:\.\d+)?)", re.IGNORECASE)


def parse_calendar_html(html: str) -> list[TrainingDay]:
    """Parse one month of calendar HTML into training days.

    Training days with zero exercises are dropped.
    """
    matches = list(_DATE_RE.finditer(html))
    if not matches:
        return []

    days: list[TrainingDay] = []
    for idx, match in enumerate(matches):
        date_str = match.group(1)
        try:
            date_obj = date_type.fromisoformat(date_str)
        except ValueError:
            continue

        start = match.start()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(html)
        chunk = html[start:end]

        exercises = _parse_exercises(chunk)
        if exercises:
            days.append(
                TrainingDay(
                    date=date_obj,
                    exercises=exercises,
                    data_source=DataSource.CALENDAR,
                )
            )

    return days


def _parse_exercises(chunk_html: str) -> list[Exercise]:
    """Extract all exercise blocks from a single day's HTML fragment."""
    soup = BeautifulSoup(chunk_html, "lxml")
    exercises: list[Exercise] = []

    for prefix in soup.find_all("span", class_="calendar-prefix"):
        if not isinstance(prefix, Tag):
            continue
        order = prefix.get_text(strip=True)
        name = _find_exercise_name(prefix)
        if not name:
            continue
        prescribed = _find_prescribed_sets(prefix)
        exercises.append(Exercise(order=order, name=name, prescribed=prescribed))
    return exercises


def _find_exercise_name(prefix: Tag) -> str | None:
    """Find the exercise name near the calendar-prefix span."""
    # The <p> holding the exercise name is the nearest <p> sibling in parent scope.
    parent = prefix.parent
    if parent is None:
        return None
    name_tag = parent.find("p")
    if name_tag is None:
        return None
    return name_tag.get_text(strip=True) or None


def _find_prescribed_sets(prefix: Tag) -> list[PrescribedSet]:
    """Collect every exercise-element-set div that lives in this exercise's block."""
    parent = prefix.parent
    if parent is None:
        return []

    set_divs: list[Tag] = []
    for div in parent.find_all("div"):
        if not isinstance(div, Tag):
            continue
        classes = div.get("class") or []
        if "exercise-element-set" in classes:
            set_divs.append(div)

    return [_parse_set_div(d) for d in set_divs]


def _parse_set_div(div: Tag) -> PrescribedSet:
    """Convert one <div class='exercise-element-set'> into a PrescribedSet."""
    text = " ".join(div.stripped_strings)
    prescribed = parse_set_text(text)

    dot = div.find("span", class_=lambda c: bool(c) and "dot" in c)
    status = _parse_dot_status(dot if isinstance(dot, Tag) else None)

    return prescribed.model_copy(update={"status": status})


def parse_set_text(text: str) -> PrescribedSet:
    """Parse a free-form set description like ``1 x 8 Reps @ 152.5 kg (68%)``.

    Tolerates missing fields: returns a PrescribedSet with only the fields we
    could extract and the raw text preserved in ``target_text``.
    """
    text = text.strip()

    sets: int | None = None
    reps: int | None = None
    reps_text: str | None = None
    after_at = ""

    m = _SET_TEXT_RE.search(text)
    if m:
        sets = int(m.group("sets"))
        reps_text = (m.group("reps") or "").strip() or None
        if reps_text:
            try:
                reps = int(reps_text)
            except ValueError:
                reps = None
        after_at = m.group("at") or ""

    scan_region = after_at or text

    load_kg: float | None = None
    load_display: str | None = None
    if m_kg := _LOAD_KG_RE.search(scan_region):
        load_kg = float(m_kg.group(1))
        load_display = f"{load_kg} kg"
    elif m_lbs := _LOAD_LBS_RE.search(scan_region):
        load_display = f"{float(m_lbs.group(1))} lbs"

    rpe: float | None = None
    if m_rpe := _RPE_RE.search(scan_region):
        rpe = float(m_rpe.group(1))

    pct: float | None = None
    if m_pct := _PCT_RE.search(scan_region):
        pct_str = m_pct.group(1) or m_pct.group(2)
        if pct_str:
            pct = float(pct_str) / 100.0

    return PrescribedSet(
        sets=sets,
        reps=reps,
        reps_text=reps_text,
        rpe=rpe,
        percent_1rm=pct,
        load_kg=load_kg,
        load_display=load_display,
        target_text=text,
    )


def _parse_dot_status(tag: Tag | None) -> SetStatus:
    """Read completion status from a dot <span>'s class list."""
    if tag is None:
        return SetStatus.UNKNOWN
    classes = tag.get("class") or []
    joined = " ".join(classes)
    if "--success" in joined:
        return SetStatus.COMPLETED
    if "--warning" in joined:
        return SetStatus.PARTIAL
    if "--danger" in joined:
        return SetStatus.MISSED
    if "--information" in joined:
        return SetStatus.PRESCRIBED
    return SetStatus.UNKNOWN
