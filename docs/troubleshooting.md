# Troubleshooting

Common things that go wrong, and how to fix them.

---

## Capture-side (browser)

### The scraper logs "session looks expired" or all requests 401

You are not logged in to `app.mystrengthbook.com`, or your session has
timed out since you opened the tab. Refresh the page, log in again if
necessary, and rerun the script.

### Many dates fail with HTTP 500

MSB's server returns a 500 when the `?month=YYYY-MM` query parameter is
missing from the URL. The bundled scraper always includes it, so if you
are seeing this you are probably running an older version — update to
the latest `scraper/msb-scraper.js`.

### Many dates fail with HTTP 502 or 503

MSB is under load on their side. These failures are usually transient.
Wait a couple of minutes and rerun the scraper; it resumes where it left
off on a per-date basis.

### A date logs "missing actuals-outcomes marker"

The day's page loaded successfully but did not contain any logged
actuals. This is normal for dates where:

- The coach had a template on the calendar but you did not actually
  train that day
- The server returned a partially rendered / blank response on that
  date

You can safely ignore these — the day gets skipped, not crashed on.

### The browser blocks the automatic download

Click the permission prompt to allow downloads from the MSB tab, or run
`window._msbDownload()` in the console to re-trigger the save. The
scraper keeps the result on `window._msbData` until you refresh the tab.

### The scraper seems to run twice, in parallel

This used to happen when an outer wrapper re-evaluated the IIFE. The
current script short-circuits on a repeat invocation with a console
message. If you still see two concurrent runs, refresh the tab to
reset `window._msbRunning`, then paste the script once.

---

## Parse-side (Python)

### `msb-extractor: command not found`

You installed with `pip` but the entry point is not on your PATH.
Either activate the virtual environment you installed into, or run the
CLI as a module: `python -m msb_extractor parse …`.

### `ModuleNotFoundError: No module named 'msb_extractor'`

You're running from a shell where the package isn't installed. Run
`pip install msb-extractor` (or `pip install -e .` from a clone), or
prefix the call with `python -m` from the repo root.

### `pydantic.ValidationError` when loading the JSON

The capture file is either corrupted or from an incompatible scraper
version. Re-run the scraper — the current version writes
`schemaVersion: 2` with `calendars` and `days` dicts. The parser still
accepts v1 captures but will not have the full per-set comments they
pre-date (see "Comments end in `...`" below).

### Comments in the xlsx end in `...`

MyStrengthBook server-renders only a ~40-character preview of each
per-set comment. From `schemaVersion: 2` onwards the scraper clicks
each preview in a hidden iframe and recovers the full text, writing it
into a `data-full-comment` attribute the parser prefers.

If your comments are still truncated:

1. Check the capture's `schemaVersion` — open `msb_capture.json` and
   look at the first line; `1` means you're on a pre-fix capture. Re-run
   the current scraper to regenerate.
2. Confirm the scraper finished the expansion pass. Its last console
   line should be `[msb] comment expansion: enriched N of M days`
   with `N` close to `M`. If `N` is 0 or much smaller than `M`, the
   iframe hydration timed out; see the scraper README's "expand failed"
   troubleshooting entry.
3. If a specific day's long comments never recovered, set
   `expandComments: false` to get a clean (preview-only) capture, open
   an issue with the day's HTML snippet, and we'll teach the matcher
   about that modal layout.

### The xlsx has no "Week ..." sheets

Either your capture contained no training days, or you passed
`--include-weekly false` (library usage only — the CLI always includes
the weekly view when there is data for it). Run `msb-extractor info`
against your capture to confirm it contains training days.

### The e1RM Charts sheet is missing

Charts only render for exercises with at least five training days of
logged e1RM data. If your capture is shorter than that, the charts
sheet is omitted.

### An exercise name renders wrong in the output

MSB coaches sometimes include stray whitespace or parentheses in
exercise names. Use the `--rename-map` flag with a small YAML file to
map source names to preferred display names — see the README section
"Exercise rename map".

### An exercise's loads look zeroed out or blank

The source prescription was percentage-based and the display was in
lbs, or MSB logged a bodyweight exercise with no numeric load. Check
the "Raw Log" sheet's `Load` column against the `Target (Prescribed)`
column to see what MSB actually exposed.

### The xlsx contains 500+ rows of "(3:0:0) Front Squat" and you only
ever did it once

The "sets" count in the Exercise Index counts prescription rows, not
the number of times you trained the exercise. For a distinct-days
count, look at the "Training Days" column.

---

## If you find a new failure mode

Open an issue with:

- The `msb-extractor --version`
- The `msb-extractor info` output on your capture
- The console log from the browser when you ran the scraper (sanitised
  if it contains anything personal)
- What you expected vs what you got

See [CONTRIBUTING.md](../CONTRIBUTING.md) for how to add a regression
test.
