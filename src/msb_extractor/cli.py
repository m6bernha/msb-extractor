"""Command-line entry point for msb-extractor."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer
from rich.console import Console
from rich.table import Table

from msb_extractor import __version__
from msb_extractor.export.xlsx_flat import write_xlsx
from msb_extractor.models import DataSource
from msb_extractor.normalize.units import Unit
from msb_extractor.parser.capture import parse_capture_file

app = typer.Typer(
    name="msb-extractor",
    help="Extract your MyStrengthBook training data into a portable spreadsheet.",
    no_args_is_help=True,
    add_completion=False,
)

_console = Console()
_err = Console(stderr=True)


def _version_callback(value: bool) -> None:
    if value:
        _console.print(f"msb-extractor {__version__}")
        raise typer.Exit()


@app.callback()
def _main(
    version: Annotated[
        bool | None,
        typer.Option(
            "--version",
            "-V",
            callback=_version_callback,
            is_eager=True,
            help="Show the version and exit.",
        ),
    ] = None,
) -> None:
    """msb-extractor CLI root."""
    del version


@app.command()
def parse(
    input_path: Annotated[
        Path,
        typer.Argument(
            exists=True,
            dir_okay=False,
            readable=True,
            resolve_path=True,
            help="Path to the msb_capture.json produced by the browser scraper.",
        ),
    ],
    output: Annotated[
        Path | None,
        typer.Option(
            "--output",
            "-o",
            help="Where to write the xlsx. Defaults to <input>.xlsx next to the input.",
        ),
    ] = None,
    units: Annotated[
        str,
        typer.Option(
            "--units",
            "-u",
            help="Display unit for loads: 'kg' or 'lbs'. Does not alter stored data.",
        ),
    ] = "kg",
    rename_map: Annotated[
        Path | None,
        typer.Option(
            "--rename-map",
            "-r",
            exists=False,
            help="Optional YAML file mapping exercise names to display names.",
        ),
    ] = None,
) -> None:
    """Parse a capture JSON and write an xlsx training log."""
    unit_checked: Unit
    if units.lower() in ("kg", "kilogram", "kilograms"):
        unit_checked = "kg"
    elif units.lower() in ("lb", "lbs", "pound", "pounds"):
        unit_checked = "lbs"
    else:
        _err.print(f"[red]Unknown unit '{units}'. Use 'kg' or 'lbs'.[/red]")
        raise typer.Exit(code=2)

    target = output or input_path.with_suffix(".xlsx")

    _console.print(f"Loading [cyan]{input_path}[/cyan]...")
    result = parse_capture_file(input_path)

    if not result.days:
        _err.print(
            "[yellow]No training days were parsed from the capture."
            " The file may be empty or malformed.[/yellow]"
        )
        raise typer.Exit(code=1)

    _console.print(
        f"Parsed [green]{len(result.days)}[/green] training days, "
        f"[green]{result.total_sets}[/green] sets total, "
        f"across [green]{len(result.exercise_names)}[/green] exercises."
    )

    out_path = write_xlsx(result, target, unit=unit_checked, rename_map_path=rename_map)
    _console.print(f"[bold green]Wrote[/bold green] [cyan]{out_path}[/cyan]")


@app.command()
def info(
    input_path: Annotated[
        Path,
        typer.Argument(
            exists=True,
            dir_okay=False,
            readable=True,
            resolve_path=True,
            help="Path to the msb_capture.json produced by the browser scraper.",
        ),
    ],
) -> None:
    """Print a short summary of a capture file without exporting."""
    result = parse_capture_file(input_path)

    if not result.days:
        _err.print("[yellow]Empty capture: no training days found.[/yellow]")
        raise typer.Exit(code=1)

    date_range = result.date_range
    first_str = date_range[0].isoformat() if date_range else "n/a"
    last_str = date_range[1].isoformat() if date_range else "n/a"

    full_count = sum(1 for d in result.days if d.data_source == DataSource.FULL_DETAIL)
    cal_count = len(result.days) - full_count

    table = Table(title="Capture summary", show_header=False, box=None, pad_edge=False)
    table.add_column(style="bold")
    table.add_column()
    table.add_row("Captured at", str(result.captured_at or "n/a"))
    table.add_row("Source", result.source)
    table.add_row("Date range", f"{first_str} - {last_str}")
    table.add_row("Training days", str(len(result.days)))
    table.add_row("  full detail", str(full_count))
    table.add_row("  calendar only", str(cal_count))
    table.add_row("Total sets", str(result.total_sets))
    table.add_row("Unique exercises", str(len(result.exercise_names)))

    _console.print(table)


if __name__ == "__main__":
    app()
