"""Generate the demo training log shipped under ``docs/examples/``.

This is a small, self-contained script that fabricates a realistic Push /
Pull / Legs block and writes the resulting xlsx. The data is synthetic, in
kilograms, and is designed to look busy enough that every output sheet has
something meaningful to show.

Run::

    python docs/examples/generate_demo.py

to regenerate ``demo_training_log.xlsx`` in this folder.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from msb_extractor.export import write_xlsx
from msb_extractor.models import (
    ActualSet,
    DataSource,
    Exercise,
    ParseResult,
    PrescribedSet,
    SetStatus,
    TrainingDay,
)


def epley_e1rm(load_kg: float, reps: int) -> float:
    """Estimated one-rep max via Epley."""
    return round(load_kg * (1.0 + reps / 30.0), 1)


def build_exercise(
    order: str,
    name: str,
    sets: int,
    reps: int,
    rpe: float,
    base_load_kg: float,
    *,
    per_set_delta: float = 0.0,
    rpe_drift: float = 0.5,
    comment_first: str | None = None,
    miss_last: bool = False,
) -> Exercise:
    """Build one synthetic exercise with prescribed + actual sets.

    ``per_set_delta`` adds kg to each successive set (useful for working-up
    patterns). ``rpe_drift`` raises the RPE on the final set by this amount.
    ``miss_last`` marks the final set as a missed rep for variety.
    """
    prescribed_text = f"{sets} x {reps} Reps @ RPE{rpe:g}"
    prescribed = [
        PrescribedSet(
            sets=sets,
            reps=reps,
            rpe=rpe,
            load_kg=base_load_kg,
            load_display=f"{base_load_kg} kg",
            target_text=prescribed_text,
            status=SetStatus.COMPLETED if not miss_last else SetStatus.PARTIAL,
        )
    ] * sets

    actuals: list[ActualSet] = []
    for i in range(sets):
        load = round(base_load_kg + per_set_delta * i, 1)
        achieved_reps = reps - (1 if miss_last and i == sets - 1 else 0)
        achieved_rpe = rpe + (rpe_drift if i == sets - 1 else 0.0)
        actuals.append(
            ActualSet(
                set_number=i + 1,
                reps=achieved_reps,
                rpe=achieved_rpe,
                load_kg=load,
                load_display=f"{load} kg",
                e1rm_kg=epley_e1rm(load, achieved_reps),
                comment=comment_first if i == 0 else None,
                status=(
                    SetStatus.PARTIAL
                    if miss_last and i == sets - 1
                    else SetStatus.COMPLETED
                ),
            )
        )

    return Exercise(order=order, name=name, prescribed=prescribed, actuals=actuals)


def build_demo() -> ParseResult:
    """Return a 6-week Push / Pull / Legs block as a ``ParseResult``."""
    block_start = date(2026, 2, 16)  # a Monday, 6 weeks before mid-Apr
    days: list[TrainingDay] = []

    for week_idx in range(6):
        progress = week_idx * 2.5  # linear weekly bump

        push_day = block_start + timedelta(days=week_idx * 7)
        pull_day = push_day + timedelta(days=2)
        legs_day = push_day + timedelta(days=4)

        push_exercises = [
            build_exercise(
                "A",
                "Barbell Bench Press",
                sets=3,
                reps=5,
                rpe=8.0,
                base_load_kg=100 + progress,
                comment_first=("Back to chest paused reps" if week_idx == 0 else None),
            ),
            build_exercise(
                "B",
                "Incline Dumbbell Press",
                sets=3,
                reps=10,
                rpe=8.0,
                base_load_kg=32.5 + progress * 0.5,
            ),
            build_exercise(
                "C",
                "Overhead Press",
                sets=3,
                reps=8,
                rpe=8.0,
                base_load_kg=55 + progress * 0.5,
                comment_first="Felt the left shoulder in set 3",
                miss_last=week_idx == 4,
            ),
            build_exercise(
                "D",
                "Weighted Dips",
                sets=3,
                reps=10,
                rpe=8.0,
                base_load_kg=20.0 + progress * 0.25,
            ),
        ]

        pull_exercises = [
            build_exercise(
                "A",
                "Conventional Deadlift",
                sets=3,
                reps=5,
                rpe=8.0,
                base_load_kg=150 + progress,
                comment_first=("PR week - send it" if week_idx == 5 else None),
            ),
            build_exercise(
                "B",
                "Barbell Row",
                sets=3,
                reps=8,
                rpe=8.0,
                base_load_kg=80 + progress * 0.5,
            ),
            build_exercise(
                "C",
                "Weighted Pull-up",
                sets=3,
                reps=8,
                rpe=8.0,
                base_load_kg=15 + progress * 0.5,
            ),
            build_exercise(
                "D",
                "Lat Pulldown",
                sets=3,
                reps=12,
                rpe=8.0,
                base_load_kg=60 + progress,
            ),
        ]

        legs_exercises = [
            build_exercise(
                "A",
                "Back Squat",
                sets=3,
                reps=5,
                rpe=8.0,
                base_load_kg=130 + progress,
                comment_first=("Hit the pocket cleanly" if week_idx == 1 else None),
            ),
            build_exercise(
                "B",
                "Romanian Deadlift",
                sets=3,
                reps=8,
                rpe=8.0,
                base_load_kg=110 + progress * 0.5,
            ),
            build_exercise(
                "C",
                "Bulgarian Split Squat",
                sets=3,
                reps=10,
                rpe=8.0,
                base_load_kg=22.5 + progress * 0.25,
            ),
            build_exercise(
                "D",
                "Standing Calf Raise",
                sets=4,
                reps=15,
                rpe=8.0,
                base_load_kg=80 + progress,
            ),
        ]

        days.append(
            TrainingDay(
                date=push_day,
                exercises=push_exercises,
                data_source=DataSource.FULL_DETAIL,
            )
        )
        days.append(
            TrainingDay(
                date=pull_day,
                exercises=pull_exercises,
                data_source=DataSource.FULL_DETAIL,
            )
        )
        days.append(
            TrainingDay(
                date=legs_day,
                exercises=legs_exercises,
                data_source=DataSource.FULL_DETAIL,
            )
        )

    return ParseResult(
        days=days,
        captured_at=datetime(2026, 4, 1, tzinfo=timezone.utc),
        source="demo.example.com",
    )


def main() -> None:
    result = build_demo()
    out_path = Path(__file__).parent / "demo_training_log.xlsx"
    write_xlsx(result, out_path)
    print(f"Wrote {out_path}")
    print(f"  {len(result.days)} training days, {result.total_sets} sets, "
          f"{len(result.exercise_names)} exercises")


if __name__ == "__main__":
    main()
