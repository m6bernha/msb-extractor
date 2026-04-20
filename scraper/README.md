# MSB Extractor — Scraper (v4)

The browser-side half of `msb-extractor`. It runs inside your own
logged-in MyStrengthBook session, fetches your training data from MSB's
own JSON API, and saves it as a single local JSON file. The Python CLI
(`src/msb_extractor/`) then parses that file into an `.xlsx` workbook.

Nothing here talks to MyStrengthBook on your behalf without you — the
script only runs when you tell your own browser to run it.

---

## How v4 works

> **v4 (schemaVersion 4) shipped 2026-04-20 and was validated against a
> real 24-month, 192-training-day session.** The scraper captures MSB's
> JSON API at `app-us.mystrengthbook.com/api/v1/exercise` directly
> rather than scraping HTML. A full 24-month capture finishes in **under
> a minute**, and per-set comments arrive in full with no truncation.
> v1-v3 HTML captures still parse, but the scraper itself is now
> JSON-only.

**Auth model.** MSB's API uses a JWT in a lowercase `auth:` header,
not cookies. The scraper intercepts one live `/api/v1/...` call the
MSB page naturally makes (by monkey-patching `window.fetch` and
`XMLHttpRequest.prototype.setRequestHeader`), lifts the token, and
reuses it for 25 parallel month fetches. Credentials mode is
`same-origin` — `include` breaks CORS on this domain.

**Output shape.** One file, `msb_capture.json`:

```json
{
  "schemaVersion": 4,
  "capturedAt": "2026-04-20T19:07:40.723Z",
  "capturedAtMs": 1745177260723,
  "source": "app.mystrengthbook.com",
  "api": {
    "base": "https://app-us.mystrengthbook.com/api/v1",
    "userId": "<your MSB user id>",
    "tokenExpires": "2026-05-20T03:22:36.643Z",
    "tokenHash": "eyJ0eX…gkls8M"
  },
  "apiMonths": {
    "2025-01": [ /* array of exercise objects for that month */ ],
    "2025-02": [ ... ],
    ...
  },
  "apiProbes": {
    "modified":        { "ok": true,  "status": 200, "body": ... },
    "workoutNote":     { "ok": true,  "status": 200, "body": ... },
    "personalRecords": { "ok": true,  "status": 200, "body": ... }
  },
  "stats": { "exercises": 908, "sets": 1871, "trainingDays": 192 }
}
```

Each exercise object contains (among other fields) a `sets[]` array
where every entry is a **prescription group** (e.g. "3x12 @ 40kg"):
top-level `reps`/`load`/`rpe` are the plan, and the actually-performed
sets live nested in `outcomes: { "0": {...}, "1": {...}, "2": {...} }`.
Per-set comments live in `comments: { "0": "...", "2": "..." }` keyed
by the same outcome index. The Python parser expands each entry into
one `ActualSet` per outcome.

### Probe endpoints (exploratory, best-effort)

After the main exercise capture lands, the scraper opportunistically
hits three endpoints MSB ships alongside `/exercise`:

| Probe | Endpoint | Scope |
|---|---|---|
| `modified` | `/api/v1/modified` | Change-log / substitutions |
| `workoutNote` | `/api/v1/workout-note` | Day-level notes |
| `personalRecords` | `/api/v1/personal-records` | PR history |

Each is fetched once with the overall capture date window, no retries.
Failures are **non-fatal** and get recorded under `apiProbes[name]`
with the HTTP status and error. These responses are stored verbatim
so the Python side can pin down their shape offline — first-class
parsers will land once a real capture confirms the fields. This is
the same "verify before parsing" discipline that rescued the main
exercise parser from yesterday's guessing.

## Observability

v4 publishes live progress on the page's window object so external
tooling (browser-automation agents, devtools snippets) can distinguish
"working" from "wedged" without scraping console text.

- `window._msbProgress` — structured progress: `phase`, `months`,
  `probes`, `stats`, `current.month`, `elapsedMs`, `etaMs`, `aborted`,
  `fatal`.
- `window._msbEvents` — rolling array of every log event with
  `t` (timestamp) and `type`.
- `window._msbData` — the capture object being built, updated live.
- `window._msbApiSample` — the first 2 exercise objects of the first
  successful month. Handy for inspecting shape in DevTools.
- `window._msbDiagnose()` — dumps progress + config + recent events.
- `window._msbDownload()` — re-saves the current `_msbData` if the
  browser blocked the initial download.
- `window._msbAbort()` — graceful stop; writes `msb_capture_partial.json`.
- `window.addEventListener('msb:progress', e => ...)` — event-driven hook.

A floating widget in the top-right of the MSB tab shows phase, month
counter, probe counter, elapsed time, and an Abort button. Disable
with `CONFIG.showWidget = false`.

## Prerequisites

- A working account on `app.mystrengthbook.com` that you are **logged in to**
  in the same browser you'll run the script from.
- A modern desktop browser (Chrome, Edge, or Firefox within the last
  couple of years).
- A **regular** browser window — not Incognito/Private. Private windows
  have a separate cookie jar and won't be authenticated.
- Auto-downloads allowed for the MSB domain. If your browser asks where
  to save each download, the first save may be blocked silently — see
  "Download didn't happen" below.

## Install (pick one)

### A. Paste into the DevTools console (simplest)

1. Open `app.mystrengthbook.com` and sign in.
2. Open DevTools (`F12`, or `Ctrl+Shift+I` / `Cmd+Opt+I`), switch to the
   **Console** tab.
3. If the console shows a self-XSS warning, type the phrase it asks for
   and press Enter to unlock paste. One-time per browser session.
4. Open `msb-scraper.js` in this folder, copy its entire contents, paste
   into the console, press Enter.
5. The widget appears. Within 15 seconds, click a day on MSB's calendar
   (or navigate to a month you haven't viewed yet) so MSB fires the
   `/api/v1` call the scraper needs to see.
6. Watch the widget. When it's done, your browser saves
   `msb_capture.json` to your downloads folder.

### B. Drag the bookmarklet (one-click reruns)

1. Open `bookmarklet.html` from this folder in your browser.
2. Drag the **MSB Extractor** button onto your bookmarks bar.
3. Navigate to `app.mystrengthbook.com` while logged in.
4. Click the bookmark. Open DevTools first if you want to see progress.

> The checked-in bookmarklet is a frozen snapshot of the v4 script. It
> does **not** yet include the new probe-endpoint capture. If you want
> the probes, paste `msb-scraper.js` directly (option A). The next
> bookmarklet regeneration will pull them in.

### C. Install as a userscript

If you already have Tampermonkey / Violentmonkey / Greasemonkey:

1. Create a new userscript.
2. Paste the contents of `msb-scraper.js` into the script body.
3. Add a metadata block at the top so the manager knows when to run it:

   ```
   // ==UserScript==
   // @name         MSB Extractor
   // @match        https://app.mystrengthbook.com/*
   // @run-at       document-idle
   // @grant        none
   // ==/UserScript==
   ```

4. Save. Keep it **disabled** by default and flip it on when you want
   to capture — the script runs the moment it loads.

## Configuration

The top of `msb-scraper.js` has a `CONFIG` object:

```js
var CONFIG = {
  startMonth: null,                 // 'YYYY-MM' or null (current month - 24)
  endMonth: null,                   // 'YYYY-MM' or null (current month)
  monthConcurrency: 5,              // parallel API fetches
  monthDelayMs: 40,
  retryCount: 2,
  retryBackoffMs: 800,
  requestTimeoutMs: 20000,
  authToken: null,                  // preset JWT; skips auto-capture
  tokenCaptureTimeoutMs: 15000,
  tokenPokeIntervalMs: 1500,
  heartbeatMs: 10000,
  showWidget: true,
  downloadFilename: 'msb_capture.json',
  partialFilename: 'msb_capture_partial.json'
};
```

Common adjustments:

- **Broader history** — set `startMonth: '2020-01'` to reach further back.
- **Preset token** — paste your JWT into `authToken` to bypass the
  15-second auto-capture window. Useful when running in a throttled tab
  or when MSB's client-side cache is aggressive. Grab the token from
  DevTools **Network** tab → filter `api/v1` → click any request →
  Request Headers → `auth: eyJ0eX...`.
- **Tighter pacing** — increase `monthDelayMs` if you're seeing rate-limit
  responses (unlikely at current defaults, but available).

## Expected runtime

- **Typical run (24 months, heavy user):** 30-60 seconds total, dominated
  by parallel JSON fetches. Probes add ~1-3 seconds.
- **Token discovery:** up to 15 seconds while the scraper waits for MSB
  to issue a natural `/api/v1/...` call. Clicking a calendar day triggers
  one immediately.
- **Download:** sub-second; the whole capture is typically 1-5 MB.

The widget's `elapsed` line advances in real time; `eta` appears once
the first handful of months complete.

## Troubleshooting

**`token_capture_timeout` after 15 seconds.**
The scraper didn't observe MSB issuing an API call. MSB's client-side
cache is likely serving from memory. Two fixes:
1. Reload the MSB page (`F5`), paste the scraper again, then click a
   day you haven't viewed this session within 15 seconds.
2. Or grab the JWT manually: DevTools → Network → filter `api/v1` →
   any request → Headers → Request Headers → copy the `auth` value →
   edit `scraper/msb-scraper.js` and set `authToken: '<paste>'`
   before pasting. This skips auto-capture entirely.

**`fatal: MSB rejected the auth token (401/403)`.**
Your MSB session expired during the run. Reload
`app.mystrengthbook.com` in the same tab to refresh the session, then
rerun the scraper.

**CORS or "failed to fetch" errors.**
You're on the wrong domain. The script must be pasted into a console
whose page origin is `app.mystrengthbook.com`. Running it on any
other site fails because the auth header won't be sent.

**Empty results / zero training days found.**
Your capture window is outside your active training history, or
MSB returned empty data. Check the widget's `months` counter — if
all 25 months "succeeded" but `exercises` is 0, the window is empty.
Try broadening `startMonth` in CONFIG.

**Download didn't happen.**
Some browsers block programmatic downloads on the first attempt. Run
this in the console:

```js
window._msbDownload()
```

If that still fails, copy the data manually:

```js
copy(JSON.stringify(window._msbData))
```

and paste into a new file named `msb_capture.json`.

**`self-XSS` paste warning.**
Chrome and Edge block pasting into the console until you type the
required phrase once per session. This is a browser safety feature,
not an error from this script.

**Stuck `_msbRunning = true` on re-paste.**
If a previous run crashed before the `finally` clause, every
subsequent paste silently no-ops. Run `window._msbRunning = false`
then re-paste. (The current scraper's `finally` block clears this,
so this should not happen, but it's an easy recovery if you see
`[msb] already running in this tab`.)

**Probe endpoints all fail.**
Probes are best-effort and non-fatal — a 404 or 400 on any of them
does not affect the main capture. Inspect
`window._msbData.apiProbes[name]` to see the error. Most likely MSB
changed the endpoint path or param shape. File an issue with the
recorded `status`, `error`, and `body` fields.

## What this does NOT do

- No passwords, tokens, or cookies are sent anywhere except
  `app-us.mystrengthbook.com`. The auth JWT the scraper uses is the
  one your browser already holds.
- No data is uploaded anywhere. The output is a local file download.
- No background execution. Close the tab and everything stops.
- No scraping of other users' data — the API only returns the
  logged-in account's own data.
