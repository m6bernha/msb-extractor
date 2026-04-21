# FAQ

Common questions from people who are not developers. If your question
is not here, check [troubleshooting.md](troubleshooting.md) or open an
issue on GitHub.

---

## Is this safe?

Yes, in the concrete senses that matter:

- **Your data never leaves your machine.** The tool talks to
  MyStrengthBook (read-only, on your own account) and saves the result
  as a local file. There is no server we run, no analytics, no
  telemetry, no auto-update check.
- **Your password is never handled.** The scraper runs inside the
  browser tab where you are already logged in. It uses the session
  your browser already holds. It never asks for a password, never
  stores one, never sends one anywhere.
- **Read-only.** The scraper only reads pages. It never submits forms,
  changes your program, or alters anything on MyStrengthBook.
- **Open source.** Every line the tool runs is in this repository,
  auditable by you or anyone else.

See [privacy.md](privacy.md) for the full data-flow diagram.

## Do I need to know how to code?

No, but you do need to be willing to:

- Install a program (Python) from its official website.
- Open a terminal window (Command Prompt on Windows, Terminal on
  Mac) once, and paste a command into it.
- Paste a JavaScript snippet into your browser's DevTools console once.

Everything else is automated. If you use the included `run.bat`
(Windows) or `run.sh` (Mac/Linux) helper, the Python side reduces to
a single double-click after the one-time setup.

If those steps sound uncomfortable, ask a friend who codes to walk
you through the first run. After that, reruns are a double-click.

## Something broke. What do I do?

In order:

1. Read the terminal output or browser console top-to-bottom. The
   error is almost always there, in plain English.
2. Check [troubleshooting.md](troubleshooting.md) — it covers the
   common failures (missing Python, expired session, CORS errors,
   blocked downloads, etc.).
3. Open an issue on GitHub with:
   - The full error (copy-paste, not a screenshot)
   - The command you ran or the step that failed
   - What you expected vs what happened

## Can I use this on someone else's account?

**No.** This tool extracts your own data from your own account. Do
not run it against:

- A friend's account without their explicit permission.
- A coach's athletes, unless each athlete has agreed.
- Anyone who is not you.

If you are a coach with access to multiple athletes, their data is
theirs, not yours. Ask before extracting, and don't publish captures
or spreadsheets that name other people's training.

## Can I share this tool with a friend?

Yes — it is MIT-licensed (see [LICENSE](../LICENSE)). Either:

- Point them at <https://github.com/m6bernha/msb-extractor> and have
  them follow the README from the top, or
- Fork the repo under your own GitHub account so you can keep your
  own customisations (see the README's "Publishing your own fork"
  section).

You cannot run the scraper *for* them. The scraper runs inside their
logged-in browser session and uses their auth token; each user must
run it themselves.

## How often should I rerun this?

The scraper captures 24 months by default in under a minute. Reasonable
cadences:

- **Weekly** — overwrite the xlsx to keep your offline log current.
- **After each program block** — rename the xlsx with the block name
  for archival (`block3_deload.xlsx` etc.).
- **Once** — if you just want a historical export.

For incremental scrapes (a few months at a time, stitched into a
larger archive), see [`tools/merge_captures.py`](../tools/merge_captures.py).
But a full 24-month refresh is fast enough that in practice most
people just rerun the whole thing.

## Where are my files when this is done?

- `captures/msb_capture.json` — the raw data pulled from MSB. Keep
  this; it is the source for regenerating the xlsx or feeding other
  exporters in the future.
- `captures/training_log.xlsx` — your spreadsheet. Open in Excel,
  Numbers, LibreOffice Calc, or upload to Google Sheets.

Both files sit on your disk only. Nothing is uploaded anywhere.

## Can I change what the spreadsheet looks like?

Partially, yes:

- **Units (kg/lbs):** pass `--units lbs` to the parse command.
- **Exercise names:** pass `--rename-map rename.yaml` with a YAML
  file mapping MSB's exercise names to names you prefer. See the
  README for the format.
- **Deeper changes (new sheets, different charts, CSV output):** the
  exporter lives in `src/msb_extractor/export/`. PRs welcome; see
  [CONTRIBUTING.md](../CONTRIBUTING.md).

## Can I feed this into something else?

Yes. The raw `msb_capture.json` is yours to do whatever you want
with:

- Load it in Pandas / R / Julia directly.
- Write your own exporter (CSV, Parquet, SQLite) — the domain models
  in `src/msb_extractor/models.py` are pydantic and trivially
  convertible.
- Stream it into a Google Sheet via a small custom script.

## Will this keep working?

MyStrengthBook can change their JSON API at any time. If they do, the
scraper may stop working until someone updates it. The repo is open,
so fixes land in public and anyone can contribute.

If that worries you, capture *now* — the JSON on your disk does not
expire, and the Python parser will keep reading it indefinitely even
if the MSB API changes tomorrow.

## I just want my data. I don't care about the spreadsheet.

You can stop after step 2 of the Quick start. The `msb_capture.json`
downloaded by the browser scraper has everything MSB gave you. Open
it in any text editor, or feed it into your tool of choice. The
Python parser is a convenience for making it human-readable, not a
necessary step.

## What is a "probe endpoint"?

A developer word for "a URL I'm trying out but haven't fully wired
up yet." The v4 scraper captures three extra URLs beyond the main
exercise endpoint (`/modified`, `/workout-note`, `/personal-records`)
and stores the raw responses under `apiProbes` in the JSON. They
aren't used by the parser yet — future versions will add support
once we have enough real-world data to know their shapes. A probe
failing does not affect your main capture.
