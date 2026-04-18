# Scraper iteration roadmap

Context for the next person (or AI agent) picking up the browser-side
capture script at [scraper/msb-scraper.js](../../scraper/msb-scraper.js).

> **Status, 2026-04-18 (v3 shipped)**: after a 3-hour v2 run confirmed
> the iframe-per-day approach was not portfolio-grade, v3 was
> rewritten to parallelise everything and to try a direct
> `/actions/refresh?modal[type]=…` endpoint probe before falling back
> to the iframe pool. Target runtime dropped from hours to **2-4
> minutes** on the fast path (probe hits), **30-60 minutes** on the
> slow path (probe misses, iframe pool runs).
>
> The following items from the Chrome PM session's 15-item list landed
> in v3: **1, 2, 4, 7, 8, 9, 10, 11, 12** and a lightweight version of
> **14** (textarea/innermost-text extractor for the modal response).
> Remaining items are tracked below.

## What shipped in v3

- Parallel calendar fetches (`monthConcurrency: 3`).
- Parallel day-detail fetches (`dayConcurrency: 3`) with per-day retry.
- Calendar-level retries (`retryCount: 2`, backoff 800 ms).
- Endpoint probe: try 7 candidate modal-types against a known
  `(exerciseId, setIndex)` from the captured HTML. If one works,
  every comment expansion becomes a single ~150 ms fetch.
- Iframe fallback pool (`expandConcurrency: 2`) with adaptive
  timing on hydration polls.
- Live progress state on `window._msbProgress` (phase, counters,
  elapsed, ETA, failure buckets).
- Rolling event log on `window._msbEvents`.
- Heartbeat every 15 s (makes tab throttling visible).
- Graceful abort via `window._msbAbort()` — writes
  `msb_capture_partial.json`.
- Preflight session check; fails loudly if not logged in.
- Floating widget in the top-right of the MSB tab with Abort button.
- `msb:progress` CustomEvent for event-driven external tooling.
- Schema bumped to `schemaVersion: 3`; Python parser stays
  backward-compatible via `extra="ignore"` on the Capture model.

## Still open (carry forward)

From the Chrome PM list:

- **#3. Parallelise comment expansion with a longer-lived iframe pool
  via `history.pushState`.** v3 ships a pool but each iframe still
  does a fresh navigation per day. If MSB's React router honours
  pushState, one hydrated iframe could serve every day in a month
  at near-zero hydration cost.
- **#5. Adaptive expansion timing.** v3 uses fixed poll intervals.
  Measure the first successful day's hydrate/modal-open time and
  scale the rest down to `max(observed * 1.5, 500 ms)`.
- **#6. Resume / checkpoint via localStorage.** Persist partial
  output every N days so a 3-minute fast-path re-run can skip days
  already captured. Especially useful for filling in months that
  MSB returned 502/503 on.
- **#13. Per-month expansion scope.** A `expandCommentsSince:
  'YYYY-MM'` knob for incremental nightly runs.
- **#14 full.** Replace the text-content heuristic with a proper DOM
  selector once we know MSB's modal container class.
- **#15. CSP-safe distribution.** Bundle the scraper into a
  pre-encoded bookmarklet so no runtime fetch to
  `raw.githubusercontent.com` is needed.

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

## Post-mortem: Claude Chrome "hang" (2026-04-18)

Symptom: user pasted a prompt into Claude Chrome pointing at the live
repo's `raw.githubusercontent.com/.../msb-scraper.js` URL. Claude Chrome
appeared to hang for 5+ minutes; user closed the tab and retried.

**Revised root cause** (after the in-session Claude Chrome PM reported
live state):

The scraper was **never hung**. It was working through the scrape at
the real pace of ~30-80 seconds per training day for days with
truncated comments. For a 24-month heavy-user account (~300 such
days), the true runtime is **~3-4 hours**, not the 15-25 minutes the
header comment and documentation previously claimed.

The user-facing perception of "hung" came from a combination of:

1. **Claude Chrome UX loop.** The agent's UI cycles through "wait for
   tooling → run JS script → wait for tooling" with 10-second polling
   gaps and no diff between polls, so the human reads it as no
   progress. This is a Chrome agent UX concern, but the scraper makes
   it worse because nothing in the tab changes between polls except
   occasional console lines.
2. **No progress heartbeat.** The script logs a terminal-state line
   only when a whole day's expansion finishes. A heavy day with six
   long comments + modal waits is silent for ~60 seconds from the
   outside.
3. **No pollable progress object.** `window._msbRunning` is a boolean;
   there is no current-date, month-index, or `lastEventAt` field an
   external poller can read to distinguish "working" from "wedged".
4. **Wildly optimistic time estimate in the docs.** "15-25 minutes"
   was the right number for a light user but off by an order of
   magnitude for a heavy user. A user seeing an hour of console
   silence when they were told to expect 25 minutes total reasonably
   concludes something broke.

**None of the original suspect causes (CSP blocking, iframe observer
interference, stuck `_msbRunning` flag) were the actual story on this
run.** The live session reported solid session cookies, no 401/403
storm, and successful per-day expansion. Keep those hypotheses in mind
for future investigations, but the dominant failure mode here was
**no external observability**, not a functional bug.

**The P0 starter patch below turns this class of hang into a clean
report.** With `window._msbProgress` updated each step and a 15-second
heartbeat, Claude Chrome (or any external poller) can distinguish
"working heavy day with six modals" from "wedged" and report that to
the human in real time.

## Full 15-item improvement list (Claude Chrome PM session, 2026-04-18)

Reproduced verbatim below. Items 1, 4, 7, 8, 10 are the recommended
first patch — low-risk small diffs that unlock external observability.

1. **Expose a live progress object.** Replace the boolean
   `_msbRunning` with an object like `window._msbProgress = { phase,
   currentMonth, monthIdx, totalMonths, currentDate, dayIdx,
   daysInMonth, capturedDays, expandedDays, failedDays, lastEventAt,
   lastMessage }`. Update it at every step. This single change lets
   any external poller (Claude, a CLI wrapper, a devtools snippet)
   tell "working" from "wedged" without parsing console text. Keep
   the boolean for backward compatibility.
2. **Parallelize day fetches (bounded).** The per-day HTML fetch is
   I/O-bound and idempotent. Add a config `dayConcurrency`
   (default 3-4) with a small Promise pool. Keep comment expansion
   serial per day (iframes are shared DOM state) but allow multiple
   days' plain HTML fetches to happen in parallel, then run expansion
   sequentially on the subset that actually has truncated previews.
   This alone likely halves wall time.
3. **Parallelize comment expansion with an iframe pool.** Currently
   one hidden iframe is used at a time. Maintain a pool of 2-3 hidden
   iframes keyed by URL; cycle through them. Many comments don't
   actually need a full navigation — once the iframe is hydrated you
   can navigate it via `history.pushState` or reuse across same-month
   days to skip cold starts. Biggest risk: MSB's client code sharing
   state across iframes; needs testing.
4. **Calendar-level retries.** `fetchDayWithRetries` has retries; the
   calendar fetch does not. Wrap `fetchText(CALENDAR_PATH + ...)` in
   the same backoff loop. The 2025-01 500 in today's run shows this
   happens in the wild.
5. **Faster expansion defaults.** `expandTimeoutMs: 8000` triggers on
   any slow hydrate; `expandPostClickMaxPolls: 30 × 100ms = 3s` is
   generous. Add adaptive timing: measure the first successful day's
   hydrate time and scale the rest down to
   `max(observed * 1.5, 2000ms)`. Also cache the hydrated iframe
   between consecutive days of the same month.
6. **Resume / checkpoint.** Periodically (every N days) stash output
   into `localStorage` under a versioned key. On re-entry detect it
   and offer to resume. A 3-hour run that loses power today has to
   start over. As a bonus, allow running the scraper chunked:
   `startMonth`/`endMonth` already exists — add a `mergeWith` option
   that loads a previously-downloaded JSON and only captures missing
   months/days.
7. **Structured log events.** Replace ad-hoc
   `console.log('[msb] ...')` strings with a
   `logEvent({type, date, month, ...})` helper that prints human text
   and pushes onto `window._msbEvents = []`. External tooling
   (including Claude) can then poll `_msbEvents.slice(lastSeen)`
   instead of scraping console text.
8. **Heartbeat.** A
   `setInterval(() => log('[msb] heartbeat ' + JSON.stringify(progressSnapshot)), 15000)`
   while running prevents the "has it died?" question and makes
   tab-throttling visible immediately (if two heartbeats are >30s
   apart when configured to 15s, the tab is being throttled).
9. **Surface and bucket expansion failures.** Track
   `{timeout: n, hydration: n, noFullRecovered: n}` in progress.
   Right now the terminal summary says "enriched P of Q" but not why
   the rest failed. That directly informs whether `expandTimeoutMs`
   needs to go up or whether the DOM selector needs a refresh.
10. **Abort handle.**
    `window._msbAbort = () => { aborted = true; }` checked at each
    `await sleep`. Lets a user gracefully stop a run and still get a
    partial JSON (right now they have to close the tab, which loses
    the download).
11. **Data integrity.** Add `capturedAtMs`, schema check in consumer,
    and a top-level `stats` object mirroring the final summary so the
    Python side can verify counts without re-parsing HTML.
12. **Documentation realism.** Update the header comment's time
    estimate. "15-25 minutes" should be "15 minutes for light users;
    several hours for heavy users with many long comments per
    session. Expect ~30-60s per training day that has truncated
    comments." Mention the comment-expansion cost up front so people
    don't assume it's hung.
13. **Optional: skip expansion for old data.** An
    `expandCommentsSince: 'YYYY-MM'` knob would let users re-run
    nightly for recent months only and accept truncated previews for
    years-old data, cutting total time dramatically on incremental
    runs.
14. **Robustness of `findExpansion`.** The 20-char prefix match +
    "ends not in ..." + "longer than preview" heuristic is brittle if
    MSB ever renders the modal with surrounding padding text. Prefer
    a DOM selector based on the modal container class (inspect the
    real modal once and target it), with the heuristic as fallback.
    Also consider a `MutationObserver` on the iframe body instead of
    polling — faster and more reliable.
15. **Security/CSP note.** The `(0, eval)(src)` loader works today but
    will break the moment MSB ships a strict CSP. Offer a same-origin
    hosting fallback (e.g. distribute a bookmarklet or a
    Chrome-extension variant) alongside the `raw.githubusercontent`
    fetch.
