# MSB Extractor - Scraper

The browser-side half of `msb-extractor`. It runs inside your own
logged-in MyStrengthBook session, collects the HTML pages your browser
can already see, and saves them as a single JSON file. The Python CLI
(`src/`) then parses that file into an `.xlsx` workbook.

Nothing here talks to MyStrengthBook on your behalf without you - the
script only runs when you tell your own browser to run it.

## What gets captured

One file, `msb_capture.json`, with this shape:

```json
{
  "schemaVersion": 1,
  "capturedAt": "2026-04-17T18:00:00.000Z",
  "source": "app.mystrengthbook.com",
  "calendars": { "2024-05": "<html>", "2024-06": "<html>", ... },
  "days":      { "2024-05-03": "<html>", "2024-05-06": "<html>", ... }
}
```

Only dates that rendered an `actuals-outcomes` block (i.e. a real
training session with logged sets) are saved. Rest days and empty pages
are skipped.

## Prerequisites

- A working account on `app.mystrengthbook.com` that you are **logged in to**
  in the same browser you'll run the script from.
- A modern desktop browser (Chrome, Edge, or Firefox within the last
  couple of years).
- A **regular** browser window - not Incognito/Private. Private windows
  have a separate cookie jar and won't be authenticated.
- Auto-downloads allowed for the MSB domain. If your browser asks where
  to save each download, the script's download may be blocked silently
  on the first try; see the "Download didn't happen" troubleshooting
  below.

## Install (pick one)

### A. Paste into the DevTools console (simplest)

1. Open `app.mystrengthbook.com` and sign in.
2. Open DevTools (`F12`, or `Ctrl+Shift+I` / `Cmd+Opt+I`), switch to the
   **Console** tab.
3. If the console shows a self-XSS warning, type the phrase it asks for
   and press Enter to unlock paste.
4. Open `msb-scraper.js` in this folder, copy its entire contents, paste
   into the console, press Enter.
5. Watch the progress lines scroll by. When it's done, your browser
   will save `msb_capture.json` to your downloads folder.

### B. Drag the bookmarklet (one-click reruns)

1. Open `bookmarklet.html` from this folder in your browser.
2. Drag the blue **MSB Extractor** button onto your bookmarks bar.
3. Navigate to `app.mystrengthbook.com` while logged in.
4. Click the bookmark. Open DevTools first if you want to see progress.

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

4. Save. The script will then run every time you land on an MSB page -
   if you don't want that, leave it **disabled** and flip it on only
   when you want to capture.

## Configuration

The top of `msb-scraper.js` has a `CONFIG` object:

```js
var CONFIG = {
  startMonth: null,        // 'YYYY-MM' or null for 24 months ago
  endMonth: null,          // 'YYYY-MM' or null for current month
  monthDelayMs: 200,       // pause between month fetches
  dayDelayMs: 300,         // pause between day fetches
  retryBackoffMs: 800,     // pause before each retry
  retryCount: 2,           // extra attempts per day (so 3 total)
  downloadFilename: 'msb_capture.json'
};
```

Edit these values before pasting if you want a narrower date range or a
different pace. The most common reason to change `startMonth` is to
back-fill older data; the defaults only cover the last 24 months.

## Expected runtime

Roughly **1.1 seconds per training day**, plus a little per month for
the calendar pages and rate-limit pauses. If you train 4 days a week and
are capturing 24 months, expect about 400 training days, or
**about 7-8 minutes**. Leave the tab visible - some browsers throttle
background timers.

## Troubleshooting

**HTTP 500 on the first fetch.**
The calendar endpoint requires `?month=YYYY-MM`; without it the server
returns 500. The script always sends it, so if you see this error you're
likely hitting a modified or truncated version - re-copy the script.

**Empty results / zero training dates found.**
Most likely your session expired. Load the MSB calendar page in the
same tab, confirm it renders your data, then rerun. The capture script
reuses the browser's cookies via `credentials: 'include'`, so if you can
see the page, the script can too.

**`[msb] skip YYYY-MM-DD - missing actuals-outcomes marker`.**
That date's page loaded but doesn't contain the block the parser needs
(it's often a blank template a coach left behind, or a day that was
logged outside the normal flow). The script retries and then moves on;
those dates will simply be absent from the output file.

**Download didn't happen.**
Some browsers block programmatic downloads the first time. Open the
console and run:

```js
window._msbDownload()
```

That re-triggers the save using the already-captured data. If that
still fails, copy the object with:

```js
copy(JSON.stringify(window._msbData))
```

and paste it into a new file named `msb_capture.json`.

**`self-XSS` paste warning in the console.**
Chrome and Edge block pasting into the console until you type the
required phrase once per session. This is a browser safety feature, not
an error from this script.

**CORS errors.**
You're on the wrong domain. The script must be pasted into a console
whose page origin is `app.mystrengthbook.com`. Running it on any other
site will fail because the cookies aren't sent.

## What this does NOT do

- No passwords, tokens, or cookies leave your browser. The script only
  calls `app.mystrengthbook.com` endpoints that your browser can already
  call.
- No data is uploaded anywhere. The output is a local file download.
- No background execution. Close the tab and everything stops.
- No scraping of other users' data - the endpoints only return the
  logged-in account's own data.
