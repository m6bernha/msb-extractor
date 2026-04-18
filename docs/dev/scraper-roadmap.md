# Scraper iteration roadmap

Context for the next person (or AI agent) picking up the browser-side
capture script at [scraper/msb-scraper.js](../../scraper/msb-scraper.js).

## What works today (schemaVersion 2)

- Fetch-based capture of every MSB monthly calendar page and every
  day-detail page in a 24-month window via the user's logged-in cookies.
- Comment-expansion pass that recovers MSB's ~40-char truncated comment
  previews by loading each affected day in a hidden same-origin iframe,
  clicking each preview, and harvesting the expanded modal text.
- IIFE with `window._msbRunning` double-invocation guard.
- Progress logged to `console.log`, result stored on `window._msbData`,
  manual re-download via `window._msbDownload()`.

## Known pain points

Observed when driving the scraper through automation (Claude Chrome or
similar browser-controlling agents):

1. **No completion signal an agent can await.** `run()` resolves a
   promise that is never surfaced to the outer caller. The fetch+eval
   wrapper the agent uses to load the script returns as soon as the
   IIFE's synchronous body finishes — 15-25 minutes before the actual
   work is done. Agents must poll the console or DOM to know when to
   stop, and often lose context mid-run.
2. **Console-only progress.** Agents see console lines as best-effort
   text. There is no structured progress object they can read
   deterministically.
3. **Iframe churn during expansion.** Creating ~150-190 hidden iframes
   in sequence, each hydrating the full MSB React app, defeats page
   observers and is wall-clock-heavy (2-6 seconds per day, serial).
4. **No resume.** A hang at month 18 discards 17 months of captured
   HTML because nothing is persisted between invocations.
5. **Silent `raw.githubusercontent.com` failures.** When the user loads
   the scraper via `fetch(raw.githubusercontent.com/...).then(eval)`
   and MSB's CSP forbids that origin, the fetch rejects, nothing runs,
   nothing is logged to the MSB console that would clue the agent in.
6. **Stuck `window._msbRunning`.** If a previous run died before the
   `.finally` clause, every subsequent invocation silently returns.
   Users need to know to reload or `window._msbRunning = false`.

## Priorities for the next iteration

### P0 — Make the scraper automation-friendly

- **Expose a completion promise.** `window._msbPromise = run();` so any
  agent can `await window._msbPromise` and know exactly when the run
  finished. Chain a resolver that returns the output object.
- **Structured progress on `window._msbStatus`.** An object like
  `{ phase: 'month'|'day'|'expand'|'done', month, date, processed,
  total, truncatedSeen, truncatedExpanded, startedAt, updatedAt,
  errors }`. Updated at every log point. Agents poll this instead of
  the console.
- **Dispatch a `CustomEvent('msb:progress', { detail: status })` on
  each update.** Gives agents an event-driven path (no polling loops).
- **Add a visible floating status widget** (top-right, dismissable)
  showing the same progress. Humans running unattended want to see
  where they are without opening DevTools.
- **Pre-flight auth check.** Before the big loop, `fetch` one known
  endpoint (`/dashboard/calendar/?month=<current>`); if it 401s or
  redirects to `/login`, fail with a clear banner and a non-zero
  `window._msbStatus.fatal` flag. Do not start capturing.

### P1 — Robustness and recovery

- **Resume across runs via `localStorage`.** Persist completed months
  and days so a second invocation picks up where a hung first one
  stopped. Key by `capturedAt` date range so resumes only apply within
  the same target window.
- **Parallel comment expansion (bounded concurrency).** Run 2-3
  iframes simultaneously instead of strictly serial. Expansion time
  drops from ~25 min to ~10 min for typical captures. Watch for iframe
  clashes (MSB modals share portals in the parent window).
- **Automatic expansion disable after N consecutive failures.** If the
  first 5 days all hit `hydration timeout`, drop `expandComments` to
  `false` for the rest of the run and surface a warning rather than
  spending another hour timing out.
- **Wake Lock hint.** `navigator.wakeLock.request('screen')` if
  available, so the user's OS/browser does not throttle the tab if
  they stop interacting with it.
- **Network-failure backoff with a visible countdown.** Currently a
  fixed 800 ms. Should exponential-backoff and show the agent/user
  what is happening.

### P2 — Diagnostics and DX

- **`window._msbDiagnose()` function.** Dumps the current status,
  last 50 console lines (keep them on `window._msbLog`), partial
  output byte size, and any error stacks. Agents can call this and
  include the result in their handoff back to the human.
- **Error banner overlay.** If any unhandled rejection reaches the
  IIFE's outer catch, put a visible overlay on the page with the
  error and the suggested fix. Silent fatal errors cost the user
  15 minutes.
- **A `scraper/diagnostic.html` page**, served by the same
  `.claude/launch.json` config, that loads a sample day capture from
  disk, runs the expansion pass against it in a sandbox, and reports
  whether the DOM predicates still match. Lets the next iteration
  catch MSB HTML drift the moment it happens, without waiting for a
  real user to hit it.
- **Record / replay harness.** Save one MSB day's raw HTML + the
  expected comment modal HTML into a fixture. A Playwright test
  loads the fixture into a real Chromium, runs the expansion logic,
  and asserts the full text is recovered. Today we have 0 end-to-end
  coverage of the expansion pass — it can silently break on MSB
  redesigns.

### P3 — Packaging and distribution

- **Minified bookmarklet that does not depend on GitHub CDN.** Inline
  the whole script into `scraper/bookmarklet.html` as a pre-encoded
  `javascript:` URL the user drags to their bookmarks bar. No runtime
  fetch to a third-party origin means MSB's CSP cannot block it.
- **Two-step CLI mode.** A `capture.ts`-style small node/python helper
  that drives a local Chromium (Playwright) through the same flow and
  dumps the JSON. Lets users skip the bookmarklet entirely and run a
  single command.
- **Chunked writes.** Instead of one 15-30 MB download at the very end,
  write an intermediate JSON every month boundary via
  `URL.createObjectURL` and `<a download>`. Users whose browser kills
  the tab still have something to work with.

## Guidance for the project-manager agent

If Claude Code Desktop (or a human PM) is iterating on this:

- **Don't break schema backwards-compat.** The Python parser still
  handles `schemaVersion: 1` captures; keep that working when bumping
  to v3. Users hang on to JSONs for a long time.
- **Every change to the expansion logic should update
  [tests/fixtures/day_detail_sample.html](../../tests/fixtures/day_detail_sample.html)
  and add a matching assertion in
  [tests/test_parser_day_detail.py](../../tests/test_parser_day_detail.py).**
  The parser test suite is the only regression guard we have today.
- **Time-box the expansion pass.** Any iteration that adds more
  per-day work should measure runtime on a real 24-month capture and
  decide whether the improvement is worth the wall-clock cost.
- **Respect the "be kind to MSB" rule in
  [CONTRIBUTING.md](../../CONTRIBUTING.md).** Concurrency increases
  should stay below 3 parallel requests.
- **Surface failures loudly, not quietly.** The scraper runs
  unattended for long stretches; a silent hang costs the user their
  evening. Prefer a visible banner + non-zero exit flag over a
  console.log no one reads.

## Post-mortem: Claude Chrome hang (2026-04-18)

Symptom: user pasted a prompt into Claude Chrome pointing at the live
repo's `raw.githubusercontent.com/.../msb-scraper.js` URL. Claude Chrome
appeared to run the fetch+eval, then hung for tens of minutes without
progress.

Suspect causes, most to least likely:

1. **Completion signal mismatch.** `(0, eval)(src)` resolves
   immediately; the real work runs in background. Claude Chrome had
   no deterministic way to know when to stop watching, so it kept
   polling a session that was already in progress and ran out of
   context. Fix: expose `window._msbPromise` (P0).
2. **Iframe observer interference.** 150+ iframes mounting and
   unmounting the full SPA confused the agent's tab observer. Fix:
   run expansion in a dedicated detached render surface (web component
   or shadow DOM) rather than top-level iframes (P1+).
3. **MSB CSP blocked `raw.githubusercontent.com`.** Should have shown
   a CORS/CSP error in DevTools Network, but Claude Chrome may not
   have surfaced it. Fix: ship the scraper bundled into the
   bookmarklet so no runtime cross-origin fetch is needed (P3).

Regardless of which of these was dominant, **P0 alone would have
turned the hang into a clean report**: either "fetch failed, here is
the CSP error" or "capture is 17% done, 12 minutes remaining."
