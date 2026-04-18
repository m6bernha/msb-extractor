"""Exercise-Progress sheet writer.

One row per (exercise, training day): the top load, the best e1RM of the
day, total sets logged, and what reps / RPE you hit on the top set. This is
the table to pivot and chart from.
"""

from __future__ import annotations

from typing import Any

from openpyxl.utils import get_column_letter
from openpyxl.worksheet.worksheet import Worksheet

from msb_extractor.export._styles import HEADER_ALIGN, HEADER_FILL, HEADER_FONT
from msb_extractor.models import ActualSet, ParseResult
from msb_extractor.normalize.exercise import apply_rename
from msb_extractor.normalize.units import Unit, format_load

_COLUMNS: list[tuple[str, int]] = [
    ("Exercise", 34),
    ("Date", 12),
    ("Day", 6),
    ("Top Load", 14),
    ("Top Reps", 9),
    ("Top RPE", 9),
    ("Best e1RM", 14),
    ("Sets", 7),
]


def write_exercise_progress(
    ws: Worksheet,
    result: ParseResult,
    unit: Unit,
    rename_map: dict[str, str],
) -> None:
    for col_idx, (label, width) in enumerate(_COLUMNS, start=1):
        cell = ws.cell(row=1, column=col_idx, value=label)
        cell.font = HEADER_FONT
        cell.fill = HEADER_FILL
        cell.alignment = HEADER_ALIGN
        ws.column_dimensions[get_column_letter(col_idx)].width = width

    rows: list[dict[str, Any]] = []
    for day in result.days:
        for ex in day.exercises:
            if not ex.actuals:
                continue
            top = _pick_top_set(ex.actuals)
            best_e1rm = max(
                (a.e1rm_kg for a in ex.actuals if a.e1rm_kg is not None),
                default=None,
            )
            rows.append(
                {
                    "exercise": apply_rename(ex.name, rename_map),
                    "date": day.date,
                    "day": day.date.strftime("%a"),
                    "top_load": top.load_kg,
                    "top_reps": top.reps,
                    "top_rpe": top.rpe,
                    "best_e1rm": best_e1rm,
                    "sets": len(ex.actuals),
                }
            )

    rows.sort(key=lambda r: (r["exercise"], r["date"]))

    for i, r in enumerate(rows, start=2):
        ws.cell(row=i, column=1, value=r["exercise"])
        date_cell = ws.cell(row=i, column=2, value=r["date"])
        date_cell.number_format = "yyyy-mm-dd"
        ws.cell(row=i, column=3, value=r["day"])
        ws.cell(
            row=i,
            column=4,
            value=format_load(r["top_load"], unit, decimals=1) if r["top_load"] else "",
        )
        ws.cell(row=i, column=5, value=r["top_reps"])
        rpe_cell = ws.cell(row=i, column=6, value=r["top_rpe"])
        if r["top_rpe"] is not None:
            rpe_cell.number_format = "0.0"
        ws.cell(
            row=i,
            column=7,
            value=format_load(r["best_e1rm"], unit, decimals=1) if r["best_e1rm"] else "",
        )
        ws.cell(row=i, column=8, value=r["sets"])

    ws.freeze_panes = "A2"
    last_col = get_column_letter(len(_COLUMNS))
    ws.auto_filter.ref = f"A1:{last_col}{max(len(rows) + 1, 1)}"


def _pick_top_set(actuals: list[ActualSet]) -> ActualSet:
    """The set with the highest load; ties broken by most reps, then set_number."""
    return max(
        actuals,
        key=lambda a: (a.load_kg or 0, a.reps or 0, -a.set_number),
    )
