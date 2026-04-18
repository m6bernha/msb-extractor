# msb-extractor

Extract your own MyStrengthBook training data into a clean, portable spreadsheet.

**Status:** alpha — in active development.

## Why this exists

MyStrengthBook (and its white-label "Training App" variants) has no user-facing export.
If you or your coach have logged months of sets, reps, loads, RPE ratings, and training
notes into the platform, that data is trapped — you cannot download it, analyze it in a
spreadsheet, or back it up against the possibility of the platform going away.

This tool gives you your data back.

## How it works

1. **Capture** — Open MyStrengthBook in your browser. While you are logged in, paste a
   single JavaScript snippet into the browser console (or drag a bookmarklet). The
   snippet re-uses your already-authenticated session to walk every month in your
   calendar and every training day, and downloads a single `.json` file with the raw
   HTML it captured.
2. **Parse** — Feed that JSON file to `msb-extractor`, which parses out every exercise,
   every set, every rep, every RPE, every load, and every comment you wrote.
3. **Export** — Out comes a multi-sheet Excel file with a flat log sheet, a weekly
   wide-format view, per-exercise progress, and a coverage summary.

> **Your data never leaves your machine.** The capture script talks only to
> MyStrengthBook. The parser runs locally. We have no server.

## Installation

```bash
pip install msb-extractor
```

Or clone and install from source:

```bash
git clone https://github.com/matthiasbernhard/msb-extractor.git
cd msb-extractor
pip install -e .
```

## Quick start

```bash
# 1. Capture your training data (see scraper/README.md)
#    Produces: msb_capture.json

# 2. Parse into a spreadsheet
msb-extractor parse msb_capture.json --output my-training.xlsx

# 3. Open my-training.xlsx in Excel / Numbers / LibreOffice
```

Useful flags:

```bash
msb-extractor parse CAPTURE.json \
    --output training.xlsx \
    --units lbs \                   # convert loads to pounds
    --rename-map rename.yaml \      # pretty exercise names
    --timezone America/Toronto      # for local-time dates
```

## What gets extracted

For every training day in your account:

- Date, day of week, exercise order (A, B, C...)
- Exercise name (as configured in your program)
- Prescribed: sets × reps @ RPE or % of 1RM
- **Actual**: reps performed, RPE logged, load lifted, %1RM, estimated 1RM
- **Your comments** on each set
- Completion status (completed / partial / missed / prescribed-only)

## Output sheets

1. **Raw Log** — one row per set, fully flat. Great for pivot tables.
2. **Weekly View** — one sheet per week, wide format with one block per workout.
3. **Exercise Progress** — per-exercise history, top sets, estimated 1RM over time.
4. **Summary** — coverage report, date range, total sets, gap days.

## Privacy and terms

- This tool is for extracting **your own** training data from **your own** account.
- Nothing is sent to any third party. No analytics, no telemetry.
- Running this against someone else's account without permission is obviously not okay.
- MyStrengthBook's terms of service may change at any time. Use at your own discretion.

## Development

```bash
pip install -e ".[dev]"
pytest
ruff check .
mypy
```

## License

MIT — see [LICENSE](LICENSE).
