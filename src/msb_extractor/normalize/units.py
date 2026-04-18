"""Unit conversion for training loads.

MSB stores everything in the lifter's native unit. We keep the native value
in-model and let exporters choose how to display it.
"""

from __future__ import annotations

from typing import Literal

Unit = Literal["kg", "lbs"]

KG_PER_LB: float = 0.45359237
LB_PER_KG: float = 1.0 / KG_PER_LB


def kg_to_lbs(kg: float) -> float:
    return kg * LB_PER_KG


def lbs_to_kg(lbs: float) -> float:
    return lbs * KG_PER_LB


def convert_kg(value: float, to: Unit) -> float:
    return value if to == "kg" else kg_to_lbs(value)


def format_load(kg: float | None, unit: Unit = "kg", decimals: int = 1) -> str | None:
    """Render a load value in the requested unit, or ``None`` when unset."""
    if kg is None:
        return None
    displayed = kg if unit == "kg" else kg_to_lbs(kg)
    return f"{displayed:.{decimals}f} {unit}"
