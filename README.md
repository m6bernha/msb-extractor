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
  +---------------------+      +----------------------+      +------------------------+
  |  Your browser tab,  |      |                      |      |                        |
  |  logged in at       |      |   msb_capture.json   |      |   training_log.xlsx    |
  |  app.mystrengthbook |----->|   (one JSON blob:    |----->|   (Raw Log, weeks,     |
  |  .com               |      |    every set, every  |      |    progress, charts)   |
  |                     |      |    full comment)     |      |                        |
  +---------------------+      +----------------------+      +------------------------+
           ^                              ^                              ^
           |                              |                              |
     Paste scraper JS            Python CLI parses it             Open in Excel /
     into DevTools               (msb-extractor parse)            Numbers / Sheets
```

1. **Capture.** Paste [`scraper/msb-scraper.js`](scraper/msb-scraper.js)
   into your browser's DevTools console while logged in to MyStrengthBook.
   It fires a handful of parallel calls to MSB's own JSON API, grabs every
   training day in a 24-month window (sets, loads, RPEs, complete per-set
   comments) and saves one `msb_capture.json` file to your Downloads folder.
   End-to-end runtime: **under one minute.**
2. **Parse.** Run `python -m msb_extractor parse msb_capture.json -o training.xlsx`.
3. **Open.** That's it. Open the xlsx in any spreadsheet app.

The spreadsheet includes a flat **Raw Log** you can pivot on, one
**Week YYYY-MM-DD** sheet per training week in the format coaches and
lifters actually use, a per-exercise **Progress** sheet, and line
charts of your estimated 1RM over time for every major lift.

## Quick start

Total time: **~5 minutes**, most of it in the browser. You only do this once.

### Step 0 — Do I have Python?

This tool needs **Python 3.11 or newer**. Open a terminal and type:

```bash
python --version       # Windows / most setups
python3 --version      # macOS if the above fails
```

If you see `Python 3.11.x` or higher, you're good. If you see anything
else — "command not found", "Python was not found", or a version below
3.11 — install Python first:

- **Windows:** download from [python.org/downloads](https://www.python.org/downloads/).
  **Tick the checkbox that says "Add Python to PATH"** during install.
  (Alternative: install "Python 3.11" from the Microsoft Store.) Close
  and reopen your terminal afterwards, then re-check the version.
- **macOS:** the easiest path is Homebrew — `brew install python@3.11`.
  Or download from python.org.
- **Linux:** `sudo apt install python3.11 python3.11-venv` on
  Debian/Ubuntu, or use your distro's package manager.

If `python --version` works but `pip --version` doesn't, your Python
install is broken — reinstall from python.org (make sure pip is
selected during install).

### Step 1 — Get the tool

```bash
git clone https://github.com/m6bernha/msb-extractor.git
cd msb-extractor
```

No `git`? Download the repo as a ZIP from
[the GitHub page](https://github.com/m6bernha/msb-extractor) (green
"Code" button → "Download ZIP"), unzip it, and `cd` into the unzipped
folder.

**Install the package** (creates a local Python environment and drops
the CLI into it):

```bash
# create an isolated Python environment
python -m venv .venv
source .venv/bin/activate                    # macOS / Linux
# .venv\Scripts\activate                     # Windows PowerShell / cmd
# source .venv/Scripts/activate              # Windows Git Bash

# install the package
pip install -e .
```

The tool is not on PyPI yet — installing from source is the current
path. If `.venv\Scripts\activate` fails on Windows PowerShell with
`running scripts is disabled`, see
[troubleshooting.md](docs/troubleshooting.md#activating-the-virtual-environment-silently-fails).

### Step 2 — Capture your training data from MSB

1. Open [app.mystrengthbook.com](https://app.mystrengthbook.com) in a **regular** browser window
   (Chrome, Edge, or Firefox — not Incognito, which has a separate cookie jar).
   Log in as normal.
2. Press `F12` to open DevTools. On Mac, use `Cmd+Option+I`.
3. Click the **Console** tab across the top of the DevTools panel.
4. If the console shows a red self-XSS warning, type the phrase it asks for
   and press Enter. That unlocks pasting for the rest of the session — it's a
   one-time browser safety check, not an error.
5. Open [`scraper/msb-scraper.js`](scraper/msb-scraper.js) in any editor,
   select all (`Ctrl+A` / `Cmd+A`), copy.
6. Click once in the console input area at the bottom of DevTools, paste, press Enter.
7. A small dark widget appears in the top-right corner of the MSB page
   showing `phase: token`. The scraper is listening for MSB's next API call
   so it can grab your auth token off it.
8. **Within 15 seconds** of pasting, click a day on MSB's calendar (or
   navigate to a month you haven't viewed this session). This forces MSB to
   issue a fresh API call, which the scraper then snatches the token from.
9. The widget advances to `phase: api` and counts up to 25 months. Typical
   runtime is 30-60 seconds end-to-end.
10. Your browser downloads `msb_capture.json` to its default download
    folder. Move or copy that file somewhere you can find it (the repo's
    `captures/` folder is a convenient choice — it's already gitignored).

**If step 8 times out** (`token_capture_timeout`), reload the MSB page (`F5`),
re-paste the scraper, and click a calendar day within 15 seconds of pasting.
Full troubleshooting lives in [scraper/README.md](scraper/README.md).

### Step 3 — Turn the capture into a spreadsheet

**Option A (easiest): use the one-click helper.**

- **Windows:** double-click `run.bat` in the repo root.
- **macOS / Linux:** in a terminal, `bash run.sh`.

The helper creates the Python environment on first run, installs the
package, parses `captures/msb_capture.json`, and offers to open the
resulting `captures/training_log.xlsx`. Subsequent runs reuse the
environment and complete in under a second.

**Option B: run the Python commands yourself.**

From the repo root, with your venv activated:

```bash
# quick sanity check — prints a summary without writing any file
python -m msb_extractor info captures/msb_capture.json

# produce the xlsx
python -m msb_extractor parse captures/msb_capture.json -o captures/training_log.xlsx
```

The `info` command prints date range, training-day count, set count, and
which probe endpoints the scraper captured. The `parse` command writes the
xlsx and prints a summary like `Parsed 192 training days, 2,484 sets total,
across 28 exercises.`

### Step 4 — Open and read the spreadsheet

Open `captures/training_log.xlsx` in Excel, Numbers, LibreOffice, or
upload it to Google Sheets.

New to the layout? Read
[docs/reading-your-spreadsheet.md](docs/reading-your-spreadsheet.md) —
it walks through each sheet (Summary, Raw Log, weekly blocks, Exercise
Progress, e1RM Charts, Exercise Index) and suggests what to do with
each.

### Stuck?

- [docs/faq.md](docs/faq.md) — non-technical questions ("is this safe?",
  "do I need to code?", "can I use this on my coach's account?").
- [docs/troubleshooting.md](docs/troubleshooting.md) — concrete fixes
  for common errors.
- [scraper/README.md](scraper/README.md) — full browser-side reference.

## What gets extracted

For every training day in your account the parser pulls out:

- Date and day of week
- Exercise order (A, B, C, ...)
- Exercise name as configured in your program
- **Prescribed**: target sets, reps, RPE or percentage of 1RM, and computed
  load where the coach used a percentage
- **Actual**: the reps you performed, the RPE you logged, the load you
  lifted, MSB's computed %1RM and estimated 1RM
- **Your comments on each set, in full.** MyStrengthBook's page HTML
  only shows a ~40-character preview (older v3 scrapers had to click
  through every one to recover the full text). v4 reads MSB's JSON API
  directly, so the complete note — whether 5 characters or 900 —
  arrives in one shot with zero truncation workaround.
- Completion status per set (completed, partial, missed, prescribed only)
- Video-attachment metadata when you uploaded a lift video

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

For stitching an initial capture together with follow-up gap-fill runs, see
[`tools/merge_captures.py`](tools/merge_captures.py) — `python -m tools.merge_captures a.json b.json -o merged.json`.

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

The scraper covers the **last 24 months by default**. To change the window
or the pacing, edit the `CONFIG` block near the top of
[scraper/msb-scraper.js](scraper/msb-scraper.js) before pasting:

```js
var CONFIG = {
  startMonth: null,                 // 'YYYY-MM'; null => current month - 24
  endMonth: null,                   // 'YYYY-MM'; null => current month
  monthConcurrency: 5,              // parallel API month fetches
  monthDelayMs: 40,
  retryCount: 2,
  retryBackoffMs: 800,
  requestTimeoutMs: 20000,
  authToken: null,                  // set a JWT here to bypass auto-capture
  tokenCaptureTimeoutMs: 15000,
  heartbeatMs: 10000,
  showWidget: true,
  downloadFilename: 'msb_capture.json',
  partialFilename: 'msb_capture_partial.json'
};
```

Full scraper docs (auth model, probe endpoints, troubleshooting failure
modes) live in [scraper/README.md](scraper/README.md).

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

### From source (current path)

```bash
git clone https://github.com/m6bernha/msb-extractor.git
cd msb-extractor
python -m venv .venv
source .venv/bin/activate    # Windows: .venv\Scripts\activate
pip install -e .
```

Requires Python 3.11 or newer.

### Dev install (adds pytest / ruff / mypy)

```bash
pip install -e ".[dev]"
```

### With pip (future)

A PyPI release is planned once the probe-endpoint parsers land. Until
then, install from source.

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
