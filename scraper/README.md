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
  "schemaVersion": 2,
  "capturedAt": "2026-04-17T18:00:00.000Z",
  "source": "app.mystrengthbook.com",
  "calendars": { "2024-05": "<html>", "2024-06": "<html>", ... },
  "days":      { "2024-05-03": "<html>", "2024-05-06": "<html>", ... }
}
```

Only dates that rendered an `actuals-outcomes` block (i.e. a real
training session with logged sets) are saved. Rest days and empty pages
are skipped.

### Full per-set comments

MyStrengthBook renders only a ~40-character preview of each per-set
comment in the server HTML (long notes are cut to a prefix and end in a
literal `...`). The full text is fetched lazily when the user clicks the
preview.

From `schemaVersion: 2` onwards the scraper recovers the full text by
loading each affected day in a hidden same-origin iframe, clicking every
truncated preview, harvesting the expanded copy from MSB's modal, and
writing it back into the captured HTML as a `data-full-comment`
attribute on the source `<p>`. The Python parser prefers that attribute,
so you get the complete comment in the `Raw Log` and `Week …` sheets.

Older v1 captures still parse, but any comment that MSB truncated will
remain cut off — re-run the current scraper to recover them.

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
  expandComments: true,    // expand truncated per-set comments via iframe
  expandTimeoutMs: 8000,   // iframe load / hydration deadline per day
  expandClickDelayMs: 150, // settle before polling after each click
  expandPostClickPollMs: 100,
  expandPostClickMaxPolls: 30,
  expandModalCloseDelayMs: 200,
  downloadFilename: 'msb_capture.json'
};
```

Edit these values before pasting if you want a narrower date range or a
different pace. The most common reason to change `startMonth` is to
back-fill older data; the defaults only cover the last 24 months.

Set `expandComments: false` to skip the comment-expansion pass. The
scrape is faster but any comment MSB truncated stays cut off.

## Expected runtime

Roughly **1.1 seconds per training day** for the base fetch, plus an
extra **2-6 seconds per day that has truncated comments** for the
comment-expansion pass. If you train 4 days a week for 24 months and
most of those days have at least one long comment, expect
**about 20-25 minutes** end-to-end. Leave the tab visible - some
browsers throttle background timers, and the hidden iframe needs the
page to be foregrounded to hydrate reliably.

If you do not care about recovering long comments and just want the
fastest possible capture, set `expandComments: false` — the scrape then
runs in **7-8 minutes** and every long comment is captured as the
`...`-terminated preview MSB renders.

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

**Log line: `expand failed (hydration timeout)` on many days.**
The iframe loaded but React did not finish hydrating before
`expandTimeoutMs` elapsed. This is usually a foreground/throttling
issue — keep the tab visible, close unrelated heavy tabs, and rerun.
If it persists, bump `expandTimeoutMs` to `15000` and retry. The run
still finishes either way; affected days just keep the `...`-terminated
previews.

**Log line: `no full comments recovered` for a day that has long notes.**
MSB rendered the modal in a layout the matcher didn't recognise (most
commonly because the full text is broken across multiple elements or
the preview had unusual whitespace). File an issue with the day's HTML
snippet — see [CONTRIBUTING.md](../CONTRIBUTING.md) — and in the
meantime set `expandComments: false` to skip the pass entirely and fall
back to MSB's preview text.

**Comments in the xlsx still end in `...`.**
Either you are parsing a v1 capture (`schemaVersion: 1`) that was
produced before the fix, or the comment-expansion pass did not recover
that specific entry. Regenerate the capture with the current script and
check `[msb] comment expansion: enriched N of M days` in the console —
N should be close to M.

## What this does NOT do

- No passwords, tokens, or cookies leave your browser. The script only
  calls `app.mystrengthbook.com` endpoints that your browser can already
  call.
- No data is uploaded anywhere. The output is a local file download.
- No background execution. Close the tab and everything stops.
- No scraping of other users' data - the endpoints only return the
  logged-in account's own data.
