# Changelog

All notable changes to `msb-extractor` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this
project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
once it ships a tagged 1.0.

## [Unreleased]

### Added
- `CaptureFileError` surfaces user-friendly errors from
  `parse_capture_file` when the capture JSON is missing, unreadable, or
  malformed. The CLI (`parse` and `info`) now prints a single-line error
  with a hint instead of a Python traceback.
- `merge-captures` is now installed as a console script (`pip install
  -e .` exposes it alongside `msb-extractor`).
- `SECURITY.md` documents the private vulnerability-reporting flow.
- `captures/` ships as a tracked directory (via `captures/.gitignore`)
  so the documented `captures/msb_capture.json` path works on first
  checkout.

### Changed
- `merge_captures` now merges `apiMonths` and `apiProbes` alongside the
  legacy `calendars` / `days`. Previously, merging two v4 captures would
  produce an empty output that downstream `parse` could not re-read.
- Scraper: the JWT fingerprint (`api.tokenHash`) is no longer written
  into the capture JSON or `window._msbData`.
- Scraper: `userId` is stripped from `apiProbes[*].url` before it lands
  in the capture.
- Scraper: `window._msbData` and `window._msbDownload` are cleared as
  soon as the download reaches disk, so co-located scripts on the MSB
  tab cannot read the full capture afterwards.
- Scraper: removed the `window._msbApiSample` debug leak that exposed
  the first two exercise records of the first month to any page script.
- `mypy` now type-checks `tools/` in addition to `src/msb_extractor/`.

## [0.1.0 — v4] — 2026-04-20

Ground-up rewrite around MSB's JSON API. Schema version bumped to 4.

### Added
- Pure JSON API capture path (`scraper/msb-scraper.js` v4) —
  single-request-per-month against `app-us.mystrengthbook.com/api/v1/exercise`.
  Runtime dropped from 15–60 minutes (v3 iframe pool) to under one
  minute for a 24-month window.
- `parser/api.py` translates the JSON responses into the same
  `TrainingDay` / `Exercise` / `ActualSet` shape the HTML parsers produce.
- Probe endpoint capture (`/modified`, `/workout-note`,
  `/personal-records`) stashed in `apiProbes` for future parsing.
- `tools/merge_captures.py` for stitching multiple captures.
- Weekly sheet view, per-exercise progress sheet, e1RM line charts.
- Non-SWE publishing UX: `run.bat` / `run.sh`, FAQ, reading guide.

### Changed
- Full set comments captured in one shot; no more modal-click expansion.
- Python parser remains backward-compatible with v1–v3 HTML captures
  through the same `parse_capture_file` entry point.
