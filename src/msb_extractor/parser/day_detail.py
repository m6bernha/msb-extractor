"""Parse a single training day's detail HTML from MSB.

Day-detail is the rich layer: it contains the lifter's actual reps, RPE,
load, estimated 1RM, per-set comments, and video attachments.

High-level shape of the source HTML (inferred from captured samples)::

    <li class="Program-Editor-Exercise is-actuals">
        <span class="calendar-prefix">A</span>
        <p>Competition (bench)</p>
        <div class="actuals-outcomes-container set0">
            <div class="target-status">
                <span class="circle-status completed"></span>
                <p class="p4">1 x 3 Reps @ RPE5</p>     <!-- prescription -->
            </div>
            <div class="actuals-outcomes">
                <p class="p4 actuals-status">...</p>    <!-- tick icon -->
                <p class="p4">1</p>                      <!-- set # -->
                <p class="p4">3</p>                      <!-- actual reps -->
                <p class="p4">5.5</p>                    <!-- actual RPE -->
                <p class="p4">180 kg</p>                 <!-- actual load -->
                <p class="p4 mobile-hidden">89%</p>      <!-- %1RM -->
                <p class="p4 mobile-hidden">225 kg</p>   <!-- e1RM -->
                <p class="p4 video"><a href=""></a></p>
                <p class="p4 description mobile-hidden">
                    It's symposium week, bad sleep...
                </p>
            </div>
        </div>
        <!-- more actuals-outcomes-container for additional sets -->
    </li>
"""

from __future__ import annotations

import re
from datetime import date as date_type

from bs4 import BeautifulSoup, Tag

from msb_extractor.models import (
    ActualSet,
    DataSource,
    Exercise,
    PrescribedSet,
    SetStatus,
    TrainingDay,
)
from msb_extractor.parser.calendar import parse_set_text

_KG_RE = re.compile(r"(\d+(?:\.\d+)?)\s*kg", re.IGNORECASE)
_LBS_RE = re.compile(r"(\d+(?:\.\d+)?)\s*lbs?", re.IGNORECASE)
_PCT_RE = re.compile(r"(\d+(?:\.\d+)?)\s*%")
_SET_CLASS_RE = re.compile(r"^set(\d+)$")


def parse_day_detail_html(html: str, date_str: str) -> TrainingDay | None:
    """Parse one day-detail HTML page.

    Returns ``None`` when the page contains no actuals (for example a
    server-rendered blank page, or a date that was never used for training).
    Use ``"actuals-outcomes"`` substring presence as the cheapest pre-check.
    """
    try:
        date_obj = date_type.fromisoformat(date_str)
    except ValueError:
        return None

    if "actuals-outcomes" not in html:
        return None

    soup = BeautifulSoup(html, "lxml")
    exercise_elements = [
        el
        for el in soup.find_all("li")
        if isinstance(el, Tag) and "Program-Editor-Exercise" in (el.get("class") or [])
    ]
    if not exercise_elements:
        return None

    exercises: list[Exercise] = []
    for li in exercise_elements:
        exercise = _parse_exercise_block(li)
        if exercise is not None:
            exercises.append(exercise)

    if not exercises:
        return None

    return TrainingDay(
        date=date_obj,
        exercises=exercises,
        data_source=DataSource.FULL_DETAIL,
    )


def _parse_exercise_block(li: Tag) -> Exercise | None:
    """Pull order letter, name, prescribed sets and actuals from one <li>."""
    order_el = li.find("span", class_="calendar-prefix")
    order = order_el.get_text(strip=True) if isinstance(order_el, Tag) else ""

    name = _find_exercise_name(li)
    if not name:
        return None

    prescribed: list[PrescribedSet] = []
    actuals: list[ActualSet] = []

    for container in li.find_all("div"):
        if not isinstance(container, Tag):
            continue
        classes = container.get("class") or []
        if "actuals-outcomes-container" not in classes:
            continue

        ps = _extract_prescribed(container)
        if ps is not None:
            prescribed.append(ps)

        act = _extract_actual(container)
        if act is not None:
            actuals.append(act)

    return Exercise(order=order, name=name, prescribed=prescribed, actuals=actuals)


def _find_exercise_name(li: Tag) -> str | None:
    """The exercise name sits in a <p> early in the <li>, outside any actuals block."""
    for p in li.find_all("p"):
        if not isinstance(p, Tag):
            continue
        classes = p.get("class") or []
        if "p4" in classes:
            continue  # that's per-set data, not the exercise name
        parent_classes: list[str] = []
        parent = p.parent
        while isinstance(parent, Tag) and parent is not li:
            parent_classes.extend(parent.get("class") or [])
            parent = parent.parent
        if any(c.startswith("actuals-") or c == "target-status" for c in parent_classes):
            continue
        text = p.get_text(strip=True)
        if text:
            return text
    return None


def _extract_prescribed(container: Tag) -> PrescribedSet | None:
    target_status = container.find(class_="target-status")
    if not isinstance(target_status, Tag):
        return None
    p_tag = target_status.find("p")
    if not isinstance(p_tag, Tag):
        return None
    text = p_tag.get_text(strip=True)
    if not text:
        return None

    status = _status_from_circle(target_status.find(class_="circle-status"))
    base = parse_set_text(text)
    return base.model_copy(update={"status": status})


def _status_from_circle(tag: object) -> SetStatus:
    if not isinstance(tag, Tag):
        return SetStatus.UNKNOWN
    classes = " ".join(tag.get("class") or [])
    if "completed" in classes:
        return SetStatus.COMPLETED
    if "partial" in classes:
        return SetStatus.PARTIAL
    if "missed" in classes or "failed" in classes:
        return SetStatus.MISSED
    if "pending" in classes or "prescribed" in classes:
        return SetStatus.PRESCRIBED
    return SetStatus.UNKNOWN


def _extract_actual(container: Tag) -> ActualSet | None:
    outcomes = container.find("div", class_="actuals-outcomes")
    if not isinstance(outcomes, Tag):
        return None

    status_p: Tag | None = None
    video_p: Tag | None = None
    description_p: Tag | None = None
    data_ps: list[Tag] = []

    for p in outcomes.find_all("p"):
        if not isinstance(p, Tag):
            continue
        classes = p.get("class") or []
        if "p4" not in classes:
            continue
        if "actuals-status" in classes:
            status_p = p
        elif "video" in classes:
            video_p = p
        elif "description" in classes:
            description_p = p
        else:
            data_ps.append(p)

    if not data_ps and status_p is None and description_p is None:
        return None

    def at(i: int) -> str:
        return data_ps[i].get_text(strip=True) if 0 <= i < len(data_ps) else ""

    set_number = _parse_int(at(0)) or _set_number_from_container(container)
    if set_number is None:
        return None

    reps = _parse_int(at(1))
    rpe = _parse_float(at(2))
    load_kg, load_display = _parse_load(at(3))
    pct = _parse_pct(at(4))
    e1rm_kg, _ = _parse_load(at(5))

    comment: str | None = None
    if description_p is not None:
        # The scraper's comment-expansion step writes the full per-set comment
        # into a data-full-comment attribute because MSB ships only a ~40-char
        # preview in the server-rendered HTML. Prefer that when present; fall
        # back to the visible text for older captures or comments short enough
        # that MSB did not truncate.
        full_attr = description_p.get("data-full-comment")
        if isinstance(full_attr, str) and full_attr.strip():
            comment = full_attr.strip()
        else:
            comment = description_p.get_text(strip=True) or None

    video_url: str | None = None
    if video_p is not None:
        link = video_p.find("a")
        if isinstance(link, Tag):
            href = link.get("href")
            if isinstance(href, str) and href:
                video_url = href

    status = SetStatus.UNKNOWN
    if status_p is not None:
        # MSB renders a tick, cross, or empty circle as an inline svg/icon
        svg = status_p.find("svg")
        status_classes = " ".join(status_p.get("class") or [])
        if svg is not None or "completed" in status_classes:
            status = SetStatus.COMPLETED
        elif "missed" in status_classes or "failed" in status_classes:
            status = SetStatus.MISSED

    return ActualSet(
        set_number=set_number,
        reps=reps,
        rpe=rpe,
        load_kg=load_kg,
        load_display=load_display,
        percent_1rm=pct,
        e1rm_kg=e1rm_kg,
        comment=comment,
        video_url=video_url,
        status=status,
    )


def _parse_int(text: str) -> int | None:
    if not text:
        return None
    try:
        return int(text.replace(",", "").strip())
    except ValueError:
        return None


def _parse_float(text: str) -> float | None:
    if not text:
        return None
    try:
        return float(text.replace(",", "").strip())
    except ValueError:
        return None


def _parse_load(text: str) -> tuple[float | None, str | None]:
    if not text:
        return None, None
    if m := _KG_RE.search(text):
        val = float(m.group(1))
        return val, f"{val} kg"
    if m := _LBS_RE.search(text):
        val = float(m.group(1))
        return None, f"{val} lbs"
    stripped = text.strip()
    return None, stripped or None


def _parse_pct(text: str) -> float | None:
    if not text:
        return None
    if m := _PCT_RE.search(text):
        return float(m.group(1)) / 100.0
    return None


def _set_number_from_container(container: Tag) -> int | None:
    for cls in container.get("class") or []:
        if m := _SET_CLASS_RE.match(cls):
            return int(m.group(1)) + 1  # class is 0-indexed, data is 1-indexed
    return None
