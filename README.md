# msb-extractor

> Extract your own MyStrengthBook training data into a portable, offline spreadsheet.
> Free. Open source. Runs entirely on your machine.

[![CI](https://github.com/m6bernha/msb-extractor/actions/workflows/ci.yml/badge.svg)](https://github.com/m6bernha/msb-extractor/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Python 3.11+](https://img.shields.io/badge/python-3.11%2B-blue.svg)](https://www.python.org/)

---

## A note from me

I built this because after a year of powerlifting with every set, RPE, and
coach comment logged into MyStrengthBook, the platform briefly went down
and I realized I had no way to get my own data out. No export button. No
download. If the servers disappeared, a year of training history would
disappear with them.

So this is the fix. Not for MSB, for me, and for anyone else whose coach
uses the same platform or one of the reskinned "Training App" variants
built on top of it. It reads the pages your already-logged-in browser can
already see, packages the full training log into a single local JSON
file, and turns it into a spreadsheet that is yours to keep, analyze,
back up, or walk away with.

It is free, open-source, runs entirely on your machine, and will never
send your data anywhere.

— Matthias

---

## Table of contents

- [What it does](#what-it-does)
- [Quick start](#quick-start)
- [What gets extracted](#what-gets-extracted)
- [Output sheets](#output-sheets)
- [CLI reference](#cli-reference)
- [Configuration](#configuration)
- [Privacy](#privacy)
- [Terms of service](#terms-of-service)
- [Installation](#installation)
- [Publishing your own fork](#publishing-your-own-fork)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

---

## What it does

```
  +---------------------+        +----------------------+        +------------------------+
  |  Your Chrome tab,   |        |                      |        |                        |
  |  logged in at       |        |   msb_capture.json   |        |   training_log.xlsx    |
  |  app.mystrengthbook |------->|   (raw HTML blobs)   |------->|   (Raw Log, weeks,     |
  |  .com               |        |                      |        |    progress, charts)   |
  +---------------------+        +----------------------+        +------------------------+
           ^                              ^                              ^
           |                              |                              |
     Paste scraper JS             Python CLI parses it           Open in Excel / Numbers
     into DevTools                                                 / LibreOffice
```

1. **Capture.** Open MyStrengthBook in your browser. While logged in, paste
   a small JavaScript snippet into the DevTools console (or drag a one-click
   bookmarklet). The snippet walks every calendar month and every training
   day in your account and saves one JSON file to your computer.
2. **Parse.** Run `msb-extractor parse ./msb_capture.json -o my-log.xlsx`.
3. **Open.** That's it. Open the xlsx in the spreadsheet app of your choice.

The spreadsheet includes a flat "Raw Log" you can pivot on, one "Week ..."
sheet per training week in the format coaches and lifters actually use
(exercise rows with per-set loads), a per-exercise Progress sheet, and
line charts of your estimated 1RM over time for every major lift.

## Quick start

```bash
# 1. Install
pip install msb-extractor

# 2. Capture your data
#    Follow scraper/README.md (copy-paste script, or use the bookmarklet).
#    You'll end up with a msb_capture.json file in your Downloads folder.

# 3. Parse into a spreadsheet
msb-extractor parse ~/Downloads/msb_capture.json -o ~/my-training-log.xlsx

# 4. Open the xlsx in Excel, Numbers, LibreOffice, Google Sheets...
```

If you have not got the package installed yet and do not want to, clone the
repo and run `python -m msb_extractor parse …` directly.

## What gets extracted

For every training day in your account the parser pulls out:

- Date and day of week
- Exercise order (A, B, C, ...)
- Exercise name as configured in your program
- **Prescribed**: target sets, reps, RPE or percentage of 1RM, and computed
  load where the coach used a percentage
- **Actual**: the reps you performed, the RPE you logged, the load you
  lifted, MSB's computed %1RM and estimated 1RM
- **Your comments** on each set, in full (the notes you typed into the
  "description" box — "elbows slotted", "felt strong", "depresso 2am
  session"). MyStrengthBook only ships a ~40-character preview in the
  page HTML, so the scraper clicks every truncated note in a hidden
  iframe and recovers the full text before writing the capture file —
  see [scraper/README.md](scraper/README.md#full-per-set-comments) for
  the details.
- Completion status per set (completed, partial, missed, prescribed only)
- Video-attachment links when you uploaded a lift video

## Output sheets

A sample output is checked into [docs/examples/demo_training_log.xlsx](docs/examples/demo_training_log.xlsx)
(synthetic data). Open it to see exactly what each sheet looks like.

| Sheet | Purpose |
|---|---|
| **Raw Log** | One row per set. 14 columns covering date, exercise, prescription, status, actual reps / RPE / load, %1RM, e1RM, your comment, and the data-source level. Rows from days that had full detail are shaded green. Filterable via the built-in autofilter. |
| **Week YYYY-MM-DD** (one per ISO week) | The hero sheet, modelled on the classic Jeff Nippard / Peace Era / PPL spreadsheet layout. Each day in the week is a block: Exercise / Sets / Reps / RPE / Set 1 / Set 2 / Set 3 / Set 4 / Set 5 / LSRPE / Notes. Reps that fell short of the prescription are annotated on the load cell (`"70 kg x 5"`). Comments are concatenated into the Notes column. |
| **Exercise Progress** | One row per (exercise, training day): top load, top reps, top RPE, best e1RM of the day, and the set count. The e1RM column is stored as a number with a unit-aware display format so charts and pivot tables can reference it directly. |
| **e1RM Charts** | A line chart of estimated 1RM over time for every exercise with five or more days of e1RM data. Two charts per row, sized for legibility. |
| **Exercise Index** | Every exercise in your history, ranked by total volume. Total sets, training days performed, first and last date seen. |
| **Summary** | Cover page with the extraction's generated-at timestamp, captured-at timestamp, date range, counts, and a legend explaining the row shading. |

## CLI reference

```
msb-extractor parse INPUT.json [OPTIONS]

  -o, --output PATH        Output xlsx path. Defaults to <input>.xlsx
  -u, --units TEXT         Display unit, "kg" or "lbs". Default: kg.
  -r, --rename-map PATH    Optional YAML file mapping source exercise names
                           to preferred display names.

msb-extractor info INPUT.json

  Prints a summary of a capture JSON without writing any files.
  Useful for confirming you've captured what you think you've captured.

msb-extractor --version
msb-extractor --help
```

## Configuration

### Units

Loads are stored natively (kilograms in-model) and displayed in either unit
based on the `--units` flag. The e1RM charts axis label follows the same
choice.

### Exercise rename map

MSB coaches write their own exercise names. If you want the spreadsheet to
use familiar names instead of the coach's verbatim labels, point
`--rename-map rename.yaml` at a file like:

```yaml
# rename.yaml -- maps source names to display names.
"Competition (bench)": "Flat Barbell Bench Press"
"Competition (squat)": "Back Squat"
"Competition (deadlift)": "Conventional Deadlift"
"T2K (deadlift)": "2-Count Pause Deadlift"
"Close Grip Bench (bench)": "Close Grip Bench Press"
```

Names not in the file pass through unchanged.

### Scraper configuration

The scraper covers the last 24 months by default. To change the window,
edit the `CONFIG` block at the top of
[scraper/msb-scraper.js](scraper/msb-scraper.js) before pasting:

```js
var CONFIG = {
  startMonth: '2024-01',     // inclusive
  endMonth: null,            // null = current month
  monthDelayMs: 200,
  dayDelayMs: 300,
  retryBackoffMs: 800,
  retryCount: 2,
  downloadFilename: 'msb_capture.json'
};
```

## Privacy

- **Nothing leaves your machine.** The scraper only talks to
  `app.mystrengthbook.com`, using your existing logged-in session cookies.
  The Python CLI runs locally.
- **No analytics, no telemetry, no accounts.** The authors never see your
  data.
- **No credentials handled.** The tool never asks for your MSB password and
  never stores it. All it uses is the session cookie your browser already
  has.
- **The captured JSON is yours.** It sits on your disk, in a folder of
  your choosing. Delete it whenever you want.

See [docs/privacy.md](docs/privacy.md) for a longer write-up including a
data-flow diagram.

## Terms of service

This tool is for extracting **your own** training data from **your own**
MyStrengthBook account. Please read this section before using it.

- **Not affiliated.** This project is not produced by, endorsed by, or
  connected to MyStrengthBook, their coaching partners, or any reskinned
  white-label "Training App" built on their platform. All trademarks belong
  to their respective owners.
- **Fair use of your data.** The scraper pulls pages your logged-in browser
  can already see. You are not circumventing authentication, reverse
  engineering an API, or exfiltrating anyone else's data. That said, please
  read MyStrengthBook's current Terms of Service and use this tool only in
  ways that are consistent with them.
- **Do not use this on accounts you do not own.** Running the capture script
  against a friend's, client's, or family member's MSB account without
  their clear permission is not a use case this project supports.
- **Coaches with many athletes:** if you have a coach account with access to
  multiple athletes, treat their data as theirs, not yours. Get permission
  before extracting, and do not publish captures or spreadsheets that name
  other people's training data.
- **Platform drift.** MSB can change their HTML structure at any time and
  the scraper or parser may stop working without notice. There is no
  stability guarantee.
- **No warranty.** This software is provided "as is", without warranty of
  any kind. See [LICENSE](LICENSE).

If you are a representative of MyStrengthBook and would prefer this tool
not exist, open an issue and we will talk.

See [docs/terms-of-use.md](docs/terms-of-use.md) for the full text.

## Installation

### With pip

```bash
pip install msb-extractor
```

Requires Python 3.11 or newer.

### From source

```bash
git clone https://github.com/m6bernha/msb-extractor.git
cd msb-extractor
pip install -e .
```

### Dev install

```bash
pip install -e ".[dev]"
```

## Publishing your own fork

If you want to publish your own fork of this tool under your GitHub
account:

```bash
# 1. Fork on github.com, then:
git clone https://github.com/YOUR-USERNAME/msb-extractor.git
cd msb-extractor

# 2. Update the project metadata in pyproject.toml and README.md to your
#    name and URLs.

# 3. Push your first commit. CI runs automatically on push.
```

There is no server-side component to run, so hosting amounts to sharing
a git repo and (optionally) publishing to PyPI under your own account.

## Development

```bash
# Setup
python -m venv .venv
source .venv/bin/activate       # on Windows: .venv\Scripts\activate
pip install -e ".[dev]"

# Tests
pytest

# Lint / format
ruff check .
ruff format .

# Type check
mypy

# Regenerate the example spreadsheet
python docs/examples/generate_demo.py
```

See [docs/troubleshooting.md](docs/troubleshooting.md) for known issues.

## Contributing

Bug reports, patches, and new exporter formats are welcome. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the dev workflow, commit message
style, and how to run the test suite.

## License

MIT — see [LICENSE](LICENSE). Do whatever you want with this, but I bear
no responsibility for what happens when you do.
