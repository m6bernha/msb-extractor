# Troubleshooting

Things that go wrong with v4 (schemaVersion 4) captures and how to fix
them. Scraper-specific failures are also documented in
[scraper/README.md](../scraper/README.md#troubleshooting).

---

## Install-side (before you run anything)

### `python: command not found` or `Python was not found`

Python is not installed, or it is not on your PATH.

- **Windows:** install from [python.org/downloads](https://www.python.org/downloads/)
  and tick "Add Python to PATH" during install. Or install from the
  Microsoft Store (search "Python 3.11"). Restart your terminal after.
- **macOS:** `brew install python@3.11`, or download from python.org.
- **Linux:** `sudo apt install python3.11 python3.11-venv` on
  Debian/Ubuntu, or use your distro's package manager.

Verify afterwards:

```bash
python --version    # or python3 --version on macOS
# expected: Python 3.11.x (or newer)
```

### `pip install -e .` fails with `ERROR: File "setup.py" not found` or similar

You're in the wrong folder. `cd` into the `msb-extractor` repo root
(the folder that contains `pyproject.toml`) and run the command again.

### `pip install -e .` fails with a compiler error on `lxml`

On Windows with an older Python, `lxml` can fail to build from source.
Fixes, in order of preference:

1. Upgrade pip first: `python -m pip install --upgrade pip`, then retry.
2. Use Python 3.11 or 3.12 specifically (3.13+ sometimes needs wheels
   that haven't been published yet).
3. If all else fails: `pip install lxml` by itself first — pip
   sometimes picks up pre-built wheels that way.

### Activating the virtual environment silently fails

On Windows PowerShell, you may see `execution of scripts is disabled`.
Run this once as administrator:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

Then `.venv\Scripts\activate` works.

On Git Bash for Windows, use `source .venv/Scripts/activate` (forward
slashes).

---

## Capture-side (browser)

### `token_capture_timeout` after 15 seconds

The scraper did not see MSB issue any `/api/v1/...` call during the
15-second listening window. MSB's client-side cache is probably
serving your page from memory.

**Fix 1 (easy):** reload the MSB page with F5, paste the scraper
again, then click a calendar day you haven't viewed this session
within 15 seconds of pasting. That forces MSB to fire an API request
the scraper can see.

**Fix 2 (deterministic):** grab the auth JWT manually and preset it.
Open DevTools → Network tab → filter `api/v1` → click any request →
Headers → Request Headers → copy the `auth` value. Then edit
`scraper/msb-scraper.js` at the top:

```js
authToken: 'eyJ0eXAiOiJKV1QiLCJhbGciOi...',
```

Paste the whole JWT on one line. Save, re-paste into the MSB console.
The scraper skips auto-discovery and goes straight to fetching.

### `fatal: MSB rejected the auth token (401/403)`

Your MSB session expired during the run. Reload
`app.mystrengthbook.com` in the same tab (logs you back in
transparently if your cookies are still valid), then rerun the
scraper. If you get redirected to the login page, log in and rerun.

### `[msb] already running in this tab`

A previous run crashed before clearing its flag. In the console:

```js
window._msbRunning = false
```

then re-paste the scraper.

### Browser blocks the download

Chrome and Edge can block programmatic downloads the first time per
session. Retry via:

```js
window._msbDownload()
```

If that still fails, copy the JSON manually:

```js
copy(JSON.stringify(window._msbData))
```

then open a text editor, paste, save as `msb_capture.json`.

### Some probes fail (HTTP 400/404)

Probes are best-effort and non-fatal — a failure here does not affect
your main capture. Inspect `window._msbData.apiProbes[<name>]` to see
the status and body. Known situations:

- `workoutNote` → HTTP 400 "A valid user is required" means the
  endpoint wants a `userId` query parameter the current scraper does
  not yet send.
- `personalRecords` → empty `{}` objects mean the endpoint works but
  you have not logged any PRs in MSB.

These do not affect the rest of your data — the full training log
still exports. Future scraper versions may wire first-class parsers
for the probes once their shape is confirmed.

### Empty / zero training days found

The capture window sits outside your active history. Check the
widget's `months` counter — if all ran but `exercise` is 0, extend
the window: edit `CONFIG.startMonth: '2020-01'` and re-paste.

---

## Parse-side (Python)

### `command not found: msb-extractor`

The CLI entry point is not on your shell PATH — you're outside the
virtual environment. Two fixes:

1. Activate the venv: `.venv\Scripts\activate` (Windows) or
   `source .venv/bin/activate` (Mac/Linux).
2. Or invoke through Python: `python -m msb_extractor parse ...`.

### `ModuleNotFoundError: No module named 'msb_extractor'`

The package is not installed in the current Python. From the repo root:

```bash
pip install -e .
```

If `pip` is not found, your Python is broken or not on PATH — see the
install-side section above.

### `pydantic.ValidationError` when loading the JSON

The capture file is either corrupted or truncated. Re-run the scraper
— a full clean capture regenerates it in ~1 minute.

Old v1-v3 HTML captures still parse, but they predate the per-set
comment fix. If you have one of those around, re-run the v4 scraper
and discard the old JSON.

### The xlsx has no "Week ..." sheets

Your capture contained zero training days. Run:

```bash
python -m msb_extractor info captures/msb_capture.json
```

If `Training days: 0`, the scraper's window missed your active
history. Broaden the capture range (see the scraper README's
"Configuration" section).

### An exercise name renders wrong

MSB coaches sometimes add stray whitespace, parentheses, or casing
that does not match across sessions. Use a rename map to normalise
them — see the README's "Exercise rename map" section.

### An exercise's loads look zeroed out

The source prescription was percentage-based ("5 @ 80%") and the
coach never entered an explicit load. Check the `Load` column in the
Raw Log sheet — empty means MSB had no numeric load for that set.
This is a MyStrengthBook data choice, not a parser bug.

### The xlsx opens but the weekly sheets look blank

Your default spreadsheet app may be mis-parsing the xlsx. Open the
file in **Excel**, **Numbers**, or **LibreOffice Calc** and try
again; Google Sheets sometimes trims xlsx features on upload.

---

## One-click helper script issues

### `run.bat` (Windows): errors before anything happens

Read the last line before `Press any key to continue`. Common causes:

- `Python is not on your PATH` → see install-side above.
- `Failed to create virtual environment` → you don't have write
  access to the folder. Move the repo out of `Program Files` or
  `OneDrive`.
- `No capture found at captures\msb_capture.json` → you haven't
  captured yet, or the file is somewhere else. Move it into
  `captures\` and double-click `run.bat` again.

### `run.sh` (Mac/Linux): `permission denied`

The script is not executable. From the repo root:

```bash
chmod +x run.sh
./run.sh
```

Or invoke via the interpreter directly: `bash run.sh`.

---

## If you find a new failure mode

Open an issue on GitHub with:

- The exact error message (copied from the terminal, not a
  screenshot — copy-paste makes it searchable)
- Output of `python -m msb_extractor info captures/msb_capture.json`
- If it's a browser-side issue, the output of
  `window._msbDiagnose()` from the MSB console
- What you expected vs what you got
- Your OS and Python version

See [CONTRIBUTING.md](../CONTRIBUTING.md) for adding a regression test.
