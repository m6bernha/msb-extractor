"""Grouping helpers: days into weeks, exercises into lifts, etc."""

from __future__ import annotations

from collections.abc import Iterable
from datetime import date as date_type
from datetime import timedelta

from msb_extractor.models import TrainingDay


def iso_week_start(d: date_type) -> date_type:
    """Return the Monday of the ISO week containing ``d``."""
    return d - timedelta(days=d.weekday())


def group_by_week(days: Iterable[TrainingDay]) -> dict[date_type, list[TrainingDay]]:
    """Group training days into buckets keyed by ISO week start (Monday)."""
    buckets: dict[date_type, list[TrainingDay]] = {}
    for day in days:
        bucket = iso_week_start(day.date)
        buckets.setdefault(bucket, []).append(day)
    for group in buckets.values():
        group.sort(key=lambda x: x.date)
    return dict(sorted(buckets.items()))
