"""Typed domain models for MSB training data.

Data flows through three layers:

1. ``Capture``              - the raw JSON the browser scraper produces
                              (one HTML blob per calendar month and per training day).
2. ``TrainingDay`` etc.     - the parsed, structured form used in-memory.
3. Exporters then render    - the structured form into xlsx / csv / json.
"""

from __future__ import annotations

from datetime import date as date_type
from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field


class SetStatus(StrEnum):
    """Completion status of a prescribed or logged set."""

    COMPLETED = "completed"
    PARTIAL = "partial"
    MISSED = "missed"
    PRESCRIBED = "prescribed"
    UNKNOWN = "unknown"


class DataSource(StrEnum):
    """Which layer of MSB captured HTML produced this row."""

    FULL_DETAIL = "full_detail"
    CALENDAR = "calendar"


class PrescribedSet(BaseModel):
    """Coach-prescribed target for one (or more identical) sets."""

    model_config = ConfigDict(extra="forbid")

    sets: int | None = None
    reps: int | None = None
    reps_text: str | None = None
    rpe: float | None = None
    percent_1rm: float | None = None
    load_kg: float | None = None
    load_display: str | None = None
    target_text: str = ""
    status: SetStatus = SetStatus.UNKNOWN


class ActualSet(BaseModel):
    """One set actually performed by the lifter."""

    model_config = ConfigDict(extra="forbid")

    set_number: int
    reps: int | None = None
    rpe: float | None = None
    load_kg: float | None = None
    load_display: str | None = None
    percent_1rm: float | None = None
    e1rm_kg: float | None = None
    comment: str | None = None
    video_url: str | None = None
    status: SetStatus = SetStatus.UNKNOWN


class Exercise(BaseModel):
    """One exercise block within a training day (e.g. 'A. Competition (bench)')."""

    model_config = ConfigDict(extra="forbid")

    order: str = ""
    name: str
    prescribed: list[PrescribedSet] = Field(default_factory=list)
    actuals: list[ActualSet] = Field(default_factory=list)
    notes: str | None = None


class TrainingDay(BaseModel):
    """A single day of training."""

    model_config = ConfigDict(extra="forbid")

    date: date_type
    exercises: list[Exercise] = Field(default_factory=list)
    data_source: DataSource = DataSource.CALENDAR
    day_label: str | None = None

    @property
    def set_count(self) -> int:
        return sum(len(ex.actuals) or len(ex.prescribed) for ex in self.exercises)


class Capture(BaseModel):
    """The top-level JSON payload the browser scraper produces."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    schema_version: int = Field(default=1, alias="schemaVersion")
    captured_at: datetime | None = Field(default=None, alias="capturedAt")
    source: str = "app.mystrengthbook.com"
    calendars: dict[str, str] = Field(default_factory=dict)
    days: dict[str, str] = Field(default_factory=dict)


class ParseResult(BaseModel):
    """The full parsed output of a capture, ready for export."""

    model_config = ConfigDict(extra="forbid")

    days: list[TrainingDay] = Field(default_factory=list)
    captured_at: datetime | None = None
    source: str = "app.mystrengthbook.com"

    @property
    def date_range(self) -> tuple[date_type, date_type] | None:
        if not self.days:
            return None
        dates = sorted(d.date for d in self.days)
        return dates[0], dates[-1]

    @property
    def total_sets(self) -> int:
        return sum(d.set_count for d in self.days)

    @property
    def exercise_names(self) -> set[str]:
        return {ex.name for day in self.days for ex in day.exercises}
