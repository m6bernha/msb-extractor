"""Optional exercise-name rewriting via a user-supplied YAML map.

MSB lets coaches name exercises however they like. A lifter porting their
data into a personal spreadsheet often prefers a cleaner or more familiar
naming scheme ("Close Grip Bench" vs "Close Grip Bench (bench)"). This
helper loads a YAML map and applies it during export.

Example ``rename.yaml``:

    "Competition (bench)": "Flat Barbell Bench Press"
    "Close Grip Bench (bench)": "Close Grip Bench Press"
    "T2K (deadlift)": "2-Count Pause Deadlift"
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml


def load_rename_map(path: str | Path | None) -> dict[str, str]:
    """Load an exercise rename map from a YAML file.

    Returns an empty dict when ``path`` is ``None`` or the file is missing,
    so callers can pass ``None`` unconditionally.
    """
    if path is None:
        return {}
    p = Path(path)
    if not p.exists():
        return {}
    data: Any = yaml.safe_load(p.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        return {}
    return {str(k): str(v) for k, v in data.items()}


def apply_rename(name: str, rename_map: dict[str, str]) -> str:
    """Look up ``name`` in ``rename_map`` and return the replacement or the original."""
    return rename_map.get(name, name)
