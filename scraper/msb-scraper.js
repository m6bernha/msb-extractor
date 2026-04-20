/*
 * msb-scraper.js (v3)
 *
 * Browser-side capture script for app.mystrengthbook.com.
 *
 * MSB does not offer a data export. This script reads the same HTML pages
 * the logged-in user's browser can already see, collects the monthly
 * calendar pages and each training day's detail page, bundles them into a
 * single JSON blob, and triggers a download.
 *
 * v3 redesign targets a portfolio-grade runtime. The previous iframe-per-day
 * expansion pass took ~30-80 seconds per day with long comments and could
 * run for hours on a heavy account. v3 addresses that in two ways:
 *
 *   1. Parallel I/O throughout. Calendar and day-detail fetches run through
 *      a small worker pool (default concurrency 3). Comment expansion has
 *      its own worker pool (default concurrency 2).
 *   2. A probe-based expansion strategy. Before opening any iframe v3 tries
 *      to fetch MSB's comment modal directly via /actions/refresh?modal[type]=...
 *      using exerciseToEdit/setIndex pairs extracted from the captured HTML.
 *      If one of the candidate modal-types returns the full comment text,
 *      every subsequent expansion is a single ~150ms fetch — dropping the
 *      expansion phase from hours to minutes. If the probe fails (MSB uses
 *      a name we did not anticipate, or the endpoint requires state we
 *      cannot reconstruct) v3 falls back to the iframe pool automatically.
 *
 * v3 also exposes structured progress on window._msbProgress and a rolling
 * event log on window._msbEvents for external automation (Claude Chrome,
 * custom scripts) to poll, plus a floating widget for humans, a heartbeat,
 * a preflight auth check, calendar retries, and a graceful abort handle.
 *
 * Usage: open app.mystrengthbook.com while logged in, open DevTools console,
 * paste this file, press Enter. A file named msb_capture.json will download
 * once the run completes. The captured data is also kept on window._msbData
 * and can be re-downloaded via window._msbDownload() if the browser blocks
 * the automatic save.
 *
 * The companion Python CLI (msb-extractor) consumes the downloaded JSON.
 */

(function () {
  'use strict';

  if (window._msbRunning) {
    console.log('[msb] already running in this tab; ignoring this invocation.');
    return;
  }
  window._msbRunning = true;

  // ------------------------------------------------------------------
  // Config
  // ------------------------------------------------------------------
  var CONFIG = {
    // Date range. null = 24 months ago through the current month.
    startMonth: null,
    endMonth: null,

    // Network concurrency and pacing.
    monthConcurrency: 3,
    dayConcurrency: 3,
    monthDelayMs: 50,
    dayDelayMs: 80,
    retryCount: 2,
    retryBackoffMs: 800,

    // Comment expansion.
    expandComments: true,
    // Probe strategy: fast path. Try to reach MSB's comment modal directly.
    probeComments: true,
    probeCommentCandidates: [
      'exercise-set-description',
      'exercise-set-comment',
      'exercise-set-note',
      'edit-set-description',
      'edit-set-comment',
      'edit-set-note',
      'set-description',
      'set-comment',
      'set-note',
      'exercise-comment',
      'exercise-description',
      'exercise-note',
      'description',
      'comment',
      'note',
      'edit-description',
      'edit-comment'
    ],
    probeConcurrency: 5,
    probeTimeoutMs: 5000,
    // Iframe fallback. Only used if the probe fails entirely.
    expandConcurrency: 2,
    expandTimeoutMs: 8000,
    expandClickDelayMs: 80,
    expandPostClickPollMs: 60,
    expandPostClickMaxPolls: 40,
    expandModalCloseDelayMs: 60,
    iframeHydrationPollMs: 150,

    // Observability.
    heartbeatMs: 15000,
    showWidget: true,

    // Resume. If a prior run crashed, landed partial data, or was aborted,
    // its calendars and captured days are stashed in IndexedDB keyed by
    // (startMonth, endMonth). On the next run with the same range the
    // scraper skips anything it already has. Disable with
    // resumeFromCheckpoint: false.
    resumeFromCheckpoint: true,
    checkpointFlushEveryDays: 10,

    downloadFilename: 'msb_capture.json',
    partialFilename: 'msb_capture_partial.json'
  };

  var CALENDAR_PATH = '/dashboard/calendar/';
  var ACTIONS_PATH = '/actions/refresh';
  var SCHEMA_VERSION = 3;

  // ------------------------------------------------------------------
  // State (exposed on window)
  // ------------------------------------------------------------------
  var aborted = false;
  window._msbAbort = function () {
    aborted = true;
    logEvent('abort_requested', {});
  };

  var progress = {
    version: 3,
    phase: 'init',
    startedAt: null,
    lastEventAt: null,
    lastMessage: '',
    elapsedMs: 0,
    etaMs: null,
    aborted: false,
    fatal: null,
    calendars: { total: 0, fetched: 0, failed: 0 },
    days: { total: 0, fetched: 0, captured: 0, skipped: 0 },
    expansion: {
      strategy: 'none',
      eligible: 0,
      processed: 0,
      enriched: 0,
      probeTotalComments: 0,
      probeEnrichedComments: 0,
      failures: { timeout: 0, hydration: 0, noRecovery: 0 }
    },
    current: { month: null, date: null }
  };
  window._msbProgress = progress;

  var events = [];
  window._msbEvents = events;

  var output = {
    schemaVersion: SCHEMA_VERSION,
    capturedAt: null,
    capturedAtMs: null,
    source: 'app.mystrengthbook.com',
    calendars: {},
    days: {}
  };
  window._msbData = output;
  window._msbDownload = function (filename) {
    return triggerDownload(output, filename || CONFIG.downloadFilename);
  };

  // Diagnostic dump — a single JSON-serialisable snapshot that automation
  // (Claude Chrome, custom tooling, a bug-report template) can pipe out of
  // the tab without scraping the console. Caps the event list so the
  // returned blob stays small.
  window._msbDiagnose = function (eventTailCount) {
    var tail = Math.max(0, Math.min(eventTailCount || 40, events.length));
    var tailStart = Math.max(0, events.length - tail);
    return {
      version: 3,
      now: Date.now(),
      running: !!window._msbRunning,
      aborted: aborted,
      progress: progress,
      config: summariseConfig(CONFIG),
      eventsTotal: events.length,
      recentEvents: events.slice(tailStart),
      outputStats: {
        calendars: Object.keys(output.calendars || {}).length,
        days: Object.keys(output.days || {}).length,
        capturedAtMs: output.capturedAtMs
      },
      checkpoint: checkpointMeta()
    };
  };

  function summariseConfig(c) {
    // Strip anything large or function-valued; keep knobs users care about.
    var keep = [
      'startMonth', 'endMonth',
      'monthConcurrency', 'dayConcurrency', 'expandConcurrency', 'probeConcurrency',
      'expandComments', 'probeComments', 'showWidget', 'heartbeatMs',
      'retryCount', 'expandTimeoutMs', 'probeTimeoutMs',
      'resumeFromCheckpoint'
    ];
    var out = {};
    for (var i = 0; i < keep.length; i++) {
      if (c[keep[i]] !== undefined) { out[keep[i]] = c[keep[i]]; }
    }
    return out;
  }

  // ------------------------------------------------------------------
  // Logging + widget + heartbeat
  // ------------------------------------------------------------------
  function logEvent(type, detail) {
    var entry = { t: Date.now(), type: type };
    if (detail) {
      for (var k in detail) {
        if (Object.prototype.hasOwnProperty.call(detail, k)) { entry[k] = detail[k]; }
      }
    }
    events.push(entry);
    progress.lastEventAt = entry.t;
    progress.lastMessage = formatEvent(entry);
    console.log('[msb] ' + progress.lastMessage);
    updateWidget();
    try {
      window.dispatchEvent(new CustomEvent('msb:progress', { detail: progress }));
    } catch (_) { /* ignore */ }
  }

  function formatEvent(e) {
    switch (e.type) {
      case 'start':
        return 'starting capture ' + e.start + ' -> ' + e.end + ' (' + e.months + ' months)';
      case 'preflight_ok':
        return 'preflight ok — session is live';
      case 'preflight_fail':
        return 'preflight FAILED: ' + e.error;
      case 'calendar_ok':
        return 'calendar ' + e.month + ' (' + progress.calendars.fetched + '/' + progress.calendars.total + ')';
      case 'calendar_fail':
        return 'calendar ' + e.month + ' FAILED: ' + e.error;
      case 'day_ok':
        return 'day ' + e.date + ' captured (' + progress.days.captured + '/' + progress.days.total + ')';
      case 'day_skip':
        return 'day ' + e.date + ' skipped: ' + e.error;
      case 'probe_start':
        return 'probing comment endpoint with ' + e.candidates + ' candidates';
      case 'probe_hit':
        return 'probe WIN: modal[type]=' + e.modalType + ' returns full comments';
      case 'probe_miss':
        return 'probe miss — falling back to iframe pool';
      case 'expand_ok':
        return e.date + ': expanded ' + e.got + ' of ' + e.of + ' (' + e.strategy + ')';
      case 'expand_partial':
        return e.date + ': expanded ' + e.got + ' of ' + e.of + ' (' + e.strategy + ', ' + (e.of - e.got) + ' missed)';
      case 'expand_fail':
        return e.date + ': expand FAILED (' + e.error + ')';
      case 'heartbeat':
        return 'heartbeat phase=' + progress.phase +
          ' days=' + progress.days.captured + '/' + progress.days.total +
          ' exp=' + progress.expansion.enriched + '/' + progress.expansion.eligible +
          ' elapsed=' + Math.round(progress.elapsedMs / 1000) + 's' +
          (progress.etaMs != null ? ' eta=' + Math.round(progress.etaMs / 1000) + 's' : '');
      case 'abort_requested':
        return 'abort requested — saving partial';
      case 'done':
        return 'done: captured ' + e.days + ' days, enriched ' + e.enriched + '/' + e.eligible + ' expansions';
      case 'download_ok':
        return 'downloaded ' + e.filename;
      case 'download_blocked':
        return 'automatic download blocked. Run window._msbDownload() to retry.';
      case 'fatal':
        return 'fatal: ' + e.error;
      default:
        return e.type + ' ' + JSON.stringify(stripBase(e));
    }
  }

  function stripBase(e) {
    var out = {};
    for (var k in e) {
      if (k !== 't' && k !== 'type') { out[k] = e[k]; }
    }
    return out;
  }

  // Widget — small floating div in the top-right corner.
  var widgetEl = null;
  function createWidget() {
    if (!CONFIG.showWidget) { return; }
    if (document.getElementById('msb-widget')) { return; }
    widgetEl = document.createElement('div');
    widgetEl.id = 'msb-widget';
    widgetEl.style.cssText = [
      'position:fixed', 'top:12px', 'right:12px', 'z-index:2147483647',
      'min-width:260px', 'max-width:340px', 'padding:10px 12px',
      'background:rgba(15,17,21,0.94)', 'color:#e6e8ec',
      'border:1px solid #2a2f3a', 'border-radius:8px',
      'font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
      'box-shadow:0 4px 12px rgba(0,0,0,0.35)',
      'pointer-events:auto'
    ].join(';');
    widgetEl.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
      '<strong style="font-family:system-ui,sans-serif;font-size:12px">MSB Extractor v3</strong>' +
      '<button id="msb-widget-abort" style="background:#3a2020;color:#f99;border:1px solid #703030;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:11px">Abort</button>' +
      '</div>' +
      '<div id="msb-widget-body" style="white-space:pre-wrap">booting…</div>';
    document.body.appendChild(widgetEl);
    var btn = document.getElementById('msb-widget-abort');
    if (btn) { btn.addEventListener('click', function () { window._msbAbort(); }); }
  }

  function updateWidget() {
    if (!widgetEl) { return; }
    var body = document.getElementById('msb-widget-body');
    if (!body) { return; }
    var lines = [];
    if (progress.aborted) { lines.push('%c ABORTED — saving partial'); }
    if (progress.fatal) { lines.push('FATAL: ' + progress.fatal); }
    lines.push('phase:     ' + progress.phase);
    lines.push('calendars: ' + progress.calendars.fetched + '/' + progress.calendars.total +
      (progress.calendars.failed ? ' (' + progress.calendars.failed + ' failed)' : ''));
    lines.push('days:      ' + progress.days.captured + '/' + progress.days.total +
      (progress.days.skipped ? ' (' + progress.days.skipped + ' skipped)' : ''));
    if (progress.expansion.eligible > 0) {
      lines.push('expansion: ' + progress.expansion.enriched + '/' + progress.expansion.eligible +
        ' [' + progress.expansion.strategy + ']');
    }
    lines.push('elapsed:   ' + Math.round(progress.elapsedMs / 1000) + 's' +
      (progress.etaMs != null ? '  eta ' + Math.round(progress.etaMs / 1000) + 's' : ''));
    body.textContent = lines.join('\n');
  }

  var heartbeatTimer = null;
  function startHeartbeat() {
    if (heartbeatTimer) { return; }
    heartbeatTimer = setInterval(function () {
      progress.elapsedMs = progress.startedAt ? Date.now() - progress.startedAt : 0;
      recomputeEta();
      logEvent('heartbeat', {});
    }, CONFIG.heartbeatMs);
  }
  function stopHeartbeat() {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  }

  function recomputeEta() {
    var doneUnits = progress.days.captured + progress.expansion.processed;
    var totalUnits = progress.days.total + progress.expansion.eligible;
    if (doneUnits > 0 && totalUnits > doneUnits && progress.elapsedMs > 1000) {
      progress.etaMs = Math.round((progress.elapsedMs / doneUnits) * (totalUnits - doneUnits));
    } else {
      progress.etaMs = null;
    }
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
  function sleep(ms) {
    if (aborted) { return Promise.reject(new Error('aborted')); }
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        if (aborted) { reject(new Error('aborted')); } else { resolve(); }
      }, ms);
    });
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function toMonthKey(date) { return date.getFullYear() + '-' + pad2(date.getMonth() + 1); }
  function addMonths(monthKey, delta) {
    var parts = monthKey.split('-');
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    return toMonthKey(new Date(y, m - 1 + delta, 1));
  }
  function monthRange(start, end) {
    var out = [];
    var cur = start;
    if (cur > end) { return out; }
    while (cur <= end) { out.push(cur); cur = addMonths(cur, 1); }
    return out;
  }
  function resolveRange() {
    var currentMonth = toMonthKey(new Date());
    var defaultStart = addMonths(currentMonth, -24);
    return {
      start: CONFIG.startMonth || defaultStart,
      end: CONFIG.endMonth || currentMonth
    };
  }

  // Best-effort month for a YYYY-MM-DD date when resumed from checkpoint.
  // We prefer a month that is actually in the target range so the iframe
  // fallback can compose the correct day URL if it has to re-render.
  function _monthForDate(dateStr, months) {
    var prefix = dateStr.slice(0, 7);
    for (var i = 0; i < months.length; i++) {
      if (months[i] === prefix) { return months[i]; }
    }
    return prefix;
  }

  async function fetchText(url, opts) {
    opts = opts || {};
    var res = await fetch(url, { credentials: 'include' });
    if (!res.ok) {
      var err = new Error('HTTP ' + res.status);
      err.status = res.status;
      throw err;
    }
    return await res.text();
  }

  async function fetchWithRetries(url, label) {
    var lastErr = null;
    for (var attempt = 0; attempt <= CONFIG.retryCount; attempt++) {
      if (aborted) { throw new Error('aborted'); }
      try { return await fetchText(url); }
      catch (err) { lastErr = err; }
      if (attempt < CONFIG.retryCount) { await sleep(CONFIG.retryBackoffMs); }
    }
    throw lastErr || new Error('fetch failed: ' + label);
  }

  // Bounded-concurrency worker pool over an array of items. `worker(item, i)`
  // may return a promise; errors are logged per-item and do not abort the
  // pool. The pool resolves when every item has been processed (or the
  // abort signal is seen).
  async function runPool(items, concurrency, worker) {
    var idx = 0;
    async function loop() {
      while (idx < items.length && !aborted) {
        var i = idx++;
        try { await worker(items[i], i); }
        catch (err) {
          if (err && err.message === 'aborted') { throw err; }
          // swallow; worker logs its own failure
        }
      }
    }
    var workers = [];
    for (var k = 0; k < concurrency; k++) { workers.push(loop()); }
    await Promise.all(workers);
  }

  async function waitFor(predicate, timeoutMs, intervalMs) {
    intervalMs = intervalMs || 100;
    var deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (aborted) { throw new Error('aborted'); }
      try { var v = predicate(); if (v) { return v; } } catch (_) {}
      await sleep(intervalMs);
    }
    return null;
  }

  // ------------------------------------------------------------------
  // Checkpoint (IndexedDB)
  // ------------------------------------------------------------------
  //
  // We stash the in-flight output in IndexedDB so a crashed tab, an Abort,
  // or a mid-run refresh does not throw away every fetched page. Keyed by
  // the (startMonth, endMonth) range so a user running multiple captures
  // in the same browser does not clobber each other's state. localStorage
  // is not big enough — a full capture is ~15-25 MB — IndexedDB has no
  // practical ceiling for this use case.

  var DB_NAME = 'msb_extractor';
  var DB_VERSION = 1;
  var DB_STORE = 'captures';
  var _dbPromise = null;
  var _checkpointKey = null;
  var _checkpointState = null;

  function openDb() {
    if (_dbPromise) { return _dbPromise; }
    if (typeof indexedDB === 'undefined') {
      _dbPromise = Promise.resolve(null);
      return _dbPromise;
    }
    _dbPromise = new Promise(function (resolve) {
      try {
        var req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains(DB_STORE)) {
            db.createObjectStore(DB_STORE, { keyPath: 'id' });
          }
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
      } catch (_) { resolve(null); }
    });
    return _dbPromise;
  }

  async function checkpointRead(key) {
    var db = await openDb();
    if (!db) { return null; }
    return new Promise(function (resolve) {
      try {
        var tx = db.transaction(DB_STORE, 'readonly');
        var req = tx.objectStore(DB_STORE).get(key);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { resolve(null); };
      } catch (_) { resolve(null); }
    });
  }

  async function checkpointWrite(key, payload) {
    var db = await openDb();
    if (!db) { return false; }
    return new Promise(function (resolve) {
      try {
        var tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).put(Object.assign({ id: key }, payload));
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { resolve(false); };
      } catch (_) { resolve(false); }
    });
  }

  async function checkpointDelete(key) {
    var db = await openDb();
    if (!db) { return; }
    return new Promise(function (resolve) {
      try {
        var tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).delete(key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { resolve(); };
      } catch (_) { resolve(); }
    });
  }

  function checkpointKeyFor(range) {
    return 'v3:' + range.start + ':' + range.end;
  }

  function checkpointMeta() {
    if (!_checkpointState) { return null; }
    return {
      key: _checkpointKey,
      loadedAt: _checkpointState.loadedAt || null,
      previouslyCalendars: _checkpointState.previouslyCalendars || 0,
      previouslyDays: _checkpointState.previouslyDays || 0,
      previouslyExpanded: _checkpointState.previouslyExpanded || 0,
      lastFlushAt: _checkpointState.lastFlushAt || null
    };
  }

  async function maybeResumeFromCheckpoint(range) {
    if (!CONFIG.resumeFromCheckpoint) {
      _checkpointKey = checkpointKeyFor(range);
      _checkpointState = { loadedAt: null, previouslyCalendars: 0, previouslyDays: 0, previouslyExpanded: 0 };
      return;
    }
    _checkpointKey = checkpointKeyFor(range);
    var saved = await checkpointRead(_checkpointKey);
    _checkpointState = { loadedAt: null, previouslyCalendars: 0, previouslyDays: 0, previouslyExpanded: 0 };
    if (!saved || !saved.calendars || !saved.days) { return; }
    // Hydrate output with what was saved.
    output.calendars = saved.calendars || {};
    output.days = saved.days || {};
    _checkpointState.loadedAt = saved.savedAt || Date.now();
    _checkpointState.previouslyCalendars = Object.keys(output.calendars).length;
    _checkpointState.previouslyDays = Object.keys(output.days).length;
    if (saved.expansion) {
      progress.expansion.enriched = saved.expansion.enriched || 0;
      progress.expansion.processed = saved.expansion.processed || 0;
      progress.expansion.strategy = saved.expansion.strategy || 'none';
      _checkpointState.previouslyExpanded = progress.expansion.enriched;
    }
    logEvent('checkpoint_loaded', {
      calendars: _checkpointState.previouslyCalendars,
      days: _checkpointState.previouslyDays,
      expanded: _checkpointState.previouslyExpanded,
      ageMs: saved.savedAt ? (Date.now() - saved.savedAt) : null
    });
  }

  async function flushCheckpoint() {
    if (!_checkpointKey) { return; }
    var payload = {
      savedAt: Date.now(),
      schemaVersion: SCHEMA_VERSION,
      range: { start: CONFIG.startMonth || null, end: CONFIG.endMonth || null },
      calendars: output.calendars,
      days: output.days,
      expansion: {
        strategy: progress.expansion.strategy,
        enriched: progress.expansion.enriched,
        processed: progress.expansion.processed
      }
    };
    var ok = await checkpointWrite(_checkpointKey, payload);
    if (ok) {
      _checkpointState.lastFlushAt = payload.savedAt;
    }
  }

  window._msbClearCheckpoint = async function () {
    if (!_checkpointKey) {
      // Clear all v3 keys as a safety net.
      var db = await openDb();
      if (!db) { return false; }
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(DB_STORE, 'readwrite');
          tx.objectStore(DB_STORE).clear();
          tx.oncomplete = function () { resolve(true); };
          tx.onerror = function () { resolve(false); };
        } catch (_) { resolve(false); }
      });
    }
    await checkpointDelete(_checkpointKey);
    return true;
  };

  // ------------------------------------------------------------------
  // Preflight
  // ------------------------------------------------------------------
  //
  // A bare `TypeError: Failed to fetch` from the browser tells you almost
  // nothing — it is the same exception for a DNS failure, a same-origin
  // request running from an isolated JS context, a blocked extension call,
  // and a hard-dropped connection. The diagnostic variant below collects a
  // few cheap signals (page origin, navigator.cookieEnabled, HEAD of `/`)
  // so the caller gets a concrete next step instead of an opaque string.

  function describeEnv() {
    var env = {
      origin: 'unknown', href: 'unknown', cookieEnabled: null, ua: 'unknown'
    };
    try { env.origin = document.location.origin; } catch (_) {}
    try { env.href = document.location.href; } catch (_) {}
    try { env.cookieEnabled = navigator.cookieEnabled; } catch (_) {}
    try { env.ua = (navigator.userAgent || '').slice(0, 80); } catch (_) {}
    return env;
  }

  async function diagnosticFetch(url) {
    try {
      var res = await fetch(url, { credentials: 'include' });
      return { ok: true, status: res.status, type: res.type, redirected: res.redirected };
    } catch (err) {
      return { ok: false, error: err && err.message, name: err && err.name };
    }
  }

  async function preflight() {
    progress.phase = 'preflight';
    var currentMonth = toMonthKey(new Date());
    var url = CALENDAR_PATH + '?month=' + currentMonth;
    try {
      var html = await fetchText(url);
      var lower = html.toLowerCase();
      var looksAuthed = lower.indexOf('dashboard') !== -1 ||
        lower.indexOf('calendar') !== -1 ||
        lower.indexOf('exercises-frame') !== -1;
      var looksLogin = lower.indexOf('login') !== -1 && !looksAuthed;
      if (looksLogin) { throw new Error('session_expired'); }
      logEvent('preflight_ok', {});
    } catch (err) {
      // Enrich the failure with enough context that the caller can
      // distinguish environment problems from auth problems.
      var env = describeEnv();
      var rootProbe = await diagnosticFetch('/');
      logEvent('preflight_fail', {
        error: err && err.message,
        name: err && err.name,
        targetUrl: url,
        pageOrigin: env.origin,
        pageHref: env.href,
        cookieEnabled: env.cookieEnabled,
        ua: env.ua,
        rootProbe: rootProbe,
        hint: pickPreflightHint(err, env, rootProbe)
      });
      throw err;
    }
  }

  function pickPreflightHint(err, env, rootProbe) {
    var msg = (err && err.message) || '';
    // Same-origin GET that fails like this usually means the script is
    // evaluating in an isolated world whose origin differs from the tab.
    if (msg.indexOf('Failed to fetch') !== -1 || (err && err.name === 'TypeError')) {
      if (env.origin && env.origin.indexOf('mystrengthbook') === -1) {
        return 'script is running in an isolated context (' + env.origin + '); paste into DevTools console instead of eval-ing via browser automation';
      }
      if (rootProbe && rootProbe.ok === false) {
        return 'network/extension blocking fetch — try disabling tracking-protection extensions for app.mystrengthbook.com';
      }
      return 'same-origin fetch blocked; likely CSP or extension interference. Reload the tab and paste the script directly into DevTools console.';
    }
    if (msg === 'session_expired') {
      return 'log in at https://app.mystrengthbook.com and retry';
    }
    if (/HTTP 5\d\d/.test(msg)) { return 'MSB server returned 5xx — usually transient, retry in a minute'; }
    if (/HTTP 4\d\d/.test(msg)) { return 'MSB returned 4xx — session may be expired or endpoint moved'; }
    return null;
  }

  // Lightweight tester for debugging from the console. Not called by run().
  window._msbTestFetch = async function () {
    var env = describeEnv();
    var root = await diagnosticFetch('/');
    var currentMonth = toMonthKey(new Date());
    var cal = await diagnosticFetch(CALENDAR_PATH + '?month=' + currentMonth);
    return { env: env, root: root, calendar: cal };
  };

  // ------------------------------------------------------------------
  // Calendar + day phases
  // ------------------------------------------------------------------
  function extractDates(calendarHtml) {
    var pattern = /id="select-(\d{4}-\d{2}-\d{2})"[\s\S]*?exercises-frame/g;
    var seen = {};
    var dates = [];
    var match;
    while ((match = pattern.exec(calendarHtml)) !== null) {
      var d = match[1];
      if (!seen[d]) { seen[d] = true; dates.push(d); }
    }
    dates.sort();
    return dates;
  }

  async function fetchCalendarForMonth(month) {
    progress.current.month = month;
    try {
      var html = await fetchWithRetries(CALENDAR_PATH + '?month=' + month, 'calendar ' + month);
      output.calendars[month] = html;
      progress.calendars.fetched++;
      logEvent('calendar_ok', { month: month });
      return html;
    } catch (err) {
      progress.calendars.failed++;
      logEvent('calendar_fail', { month: month, error: err && err.message });
      return null;
    } finally {
      if (CONFIG.monthDelayMs > 0) { await sleep(CONFIG.monthDelayMs).catch(function () {}); }
    }
  }

  async function fetchDayDetail(date, month) {
    var url = CALENDAR_PATH + '?month=' + month + '&view=day&date=' + date;
    var lastErr = null;
    for (var attempt = 0; attempt <= CONFIG.retryCount; attempt++) {
      if (aborted) { throw new Error('aborted'); }
      try {
        var html = await fetchText(url);
        if (html.indexOf('actuals-outcomes') !== -1) { return html; }
        lastErr = new Error('missing actuals-outcomes');
      } catch (err) { lastErr = err; }
      if (attempt < CONFIG.retryCount) { await sleep(CONFIG.retryBackoffMs); }
    }
    logEvent('day_skip', { date: date, error: lastErr && lastErr.message });
    progress.days.skipped++;
    return null;
  }

  // ------------------------------------------------------------------
  // Comment expansion: probe + iframe fallback
  // ------------------------------------------------------------------
  function hasTruncatedComments(html) {
    return html.indexOf('cursor:pointer') !== -1 &&
      html.indexOf('description') !== -1 &&
      html.indexOf('...</p>') !== -1;
  }

  function isTruncatedDescription(p) {
    if (!p || p.tagName !== 'P') { return false; }
    var classes = p.className || '';
    if (classes.indexOf('description') === -1) { return false; }
    var style = p.getAttribute('style') || '';
    if (style.indexOf('cursor:pointer') === -1 && style.indexOf('cursor: pointer') === -1) {
      return false;
    }
    var text = (p.textContent || '').trim();
    return text.length > 0 && text.slice(-3) === '...';
  }

  function collectTruncatedDescriptions(root) {
    var out = [];
    var all = root.querySelectorAll('p.description');
    for (var i = 0; i < all.length; i++) {
      if (isTruncatedDescription(all[i])) { out.push(all[i]); }
    }
    return out;
  }

  // Extract every truncated-comment locator in a day's HTML, returning an
  // array of { p, exerciseId, setIndex, preview }. We walk up from each
  // truncated <p> to its enclosing container to find the setIndex class
  // (setN) and the <li> with data-id=<exerciseId>.
  function locateTruncatedComments(doc) {
    var targets = collectTruncatedDescriptions(doc);
    var out = [];
    for (var i = 0; i < targets.length; i++) {
      var p = targets[i];
      var container = p.closest('.actuals-outcomes-container');
      var li = p.closest('li.Program-Editor-Exercise');
      if (!container || !li) { out.push(null); continue; }
      var setIndex = null;
      var classes = (container.className || '').split(/\s+/);
      for (var c = 0; c < classes.length; c++) {
        var mm = /^set(\d+)$/.exec(classes[c]);
        if (mm) { setIndex = parseInt(mm[1], 10); break; }
      }
      var exerciseId = li.getAttribute('data-id') || li.getAttribute('id');
      var preview = (p.textContent || '').trim();
      if (exerciseId && setIndex != null) {
        out.push({ p: p, exerciseId: exerciseId, setIndex: setIndex, preview: preview });
      } else {
        out.push(null);
      }
    }
    return out;
  }

  // Parse the modal-response HTML for a full comment. Tries a few heuristics
  // so we do not depend on MSB's exact DOM for the modal.
  function extractFullCommentFromModalHtml(modalHtml, preview) {
    if (!modalHtml) { return null; }
    var prefixKey = preview.replace(/\.\.\.$/, '').trim();
    if (!prefixKey) { return null; }
    var keyShort = prefixKey.slice(0, Math.min(prefixKey.length, 18));
    // Strategy 1: <textarea> — edit modals often put the full text in a textarea.
    var m = /<textarea[^>]*>([\s\S]*?)<\/textarea>/i.exec(modalHtml);
    if (m && m[1]) {
      var t = decodeHtml(m[1]).trim();
      if (t.length > prefixKey.length && t.indexOf(keyShort) === 0 && t.slice(-3) !== '...') {
        return t;
      }
    }
    // Strategy 2: any element containing text that starts with keyShort, is
    // longer than the preview, and does not itself end in '...'.
    var re = new RegExp('>([^<]{' + (prefixKey.length + 1) + ',})<', 'g');
    var best = null;
    while ((m = re.exec(modalHtml)) !== null) {
      var text = decodeHtml(m[1]).trim();
      if (text.length <= prefixKey.length) { continue; }
      if (text.slice(-3) === '...') { continue; }
      if (text.indexOf(keyShort) !== 0) { continue; }
      if (!best || text.length > best.length) { best = text; }
    }
    return best;
  }

  function decodeHtml(s) {
    var el = document.createElement('textarea');
    el.innerHTML = s;
    return el.value;
  }

  async function fetchCommentModal(modalType, exerciseId, setIndex, date) {
    var utcDate = date.replace(/-/g, '');
    var url = ACTIONS_PATH + '?modal%5Btype%5D=' + encodeURIComponent(modalType) +
      '&exerciseToEdit=' + encodeURIComponent(exerciseId) +
      '&setIndex=' + setIndex +
      '&utcDate=' + utcDate;
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, CONFIG.probeTimeoutMs);
    try {
      var res = await fetch(url, { credentials: 'include', signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) { return null; }
      return await res.text();
    } catch (_) {
      clearTimeout(timer);
      return null;
    }
  }

  // Find the first captured day that has at least one truncated-comment
  // locator we can use to probe. Returns { date, locator } or null.
  function pickProbeCandidate(capturedMap) {
    var dates = Object.keys(capturedMap);
    for (var i = 0; i < dates.length; i++) {
      var parser = new DOMParser();
      var doc = parser.parseFromString(capturedMap[dates[i]].html, 'text/html');
      var locs = locateTruncatedComments(doc);
      for (var j = 0; j < locs.length; j++) {
        if (locs[j]) { return { date: dates[i], locator: locs[j] }; }
      }
    }
    return null;
  }

  // Discover MSB's comment modal endpoint. Returns the winning modal-type
  // string, or null if no candidate worked. Probes every candidate in
  // parallel so the whole discovery phase is bounded by the single
  // slowest fetch (~probeTimeoutMs) rather than the sum of all fetches.
  async function discoverCommentEndpoint(capturedMap) {
    var sample = pickProbeCandidate(capturedMap);
    if (!sample) { return null; }
    logEvent('probe_start', { candidates: CONFIG.probeCommentCandidates.length });

    var attempts = CONFIG.probeCommentCandidates.map(function (cand) {
      return fetchCommentModal(cand, sample.locator.exerciseId, sample.locator.setIndex, sample.date)
        .then(function (body) {
          if (!body) { return null; }
          var full = extractFullCommentFromModalHtml(body, sample.locator.preview);
          return full ? cand : null;
        })
        .catch(function () { return null; });
    });

    var results = await Promise.all(attempts);
    // Honour the user's candidate ordering: take the first winner.
    for (var i = 0; i < results.length; i++) {
      if (results[i]) {
        logEvent('probe_hit', { modalType: results[i] });
        return results[i];
      }
    }
    logEvent('probe_miss', {});
    return null;
  }

  // Fast-path expansion: fetch each comment modal directly, no iframe.
  async function expandViaProbe(capturedMap, modalType) {
    progress.expansion.strategy = 'endpoint';
    var dates = Object.keys(capturedMap).filter(function (d) {
      return hasTruncatedComments(capturedMap[d].html);
    });
    progress.expansion.eligible = dates.length;
    if (dates.length === 0) { return; }

    // Collect every (date, locator) pair up front so we can run a single
    // bounded worker pool across all comments.
    var tasks = [];
    var perDate = {};
    for (var i = 0; i < dates.length; i++) {
      var date = dates[i];
      var parser = new DOMParser();
      var doc = parser.parseFromString(capturedMap[date].html, 'text/html');
      var locs = locateTruncatedComments(doc);
      var targets = collectTruncatedDescriptions(doc);
      perDate[date] = { doc: doc, locs: locs, targets: targets, fulls: new Array(targets.length) };
      for (var j = 0; j < locs.length; j++) {
        if (locs[j]) {
          tasks.push({ date: date, index: j, locator: locs[j] });
        }
      }
    }
    progress.expansion.probeTotalComments = tasks.length;

    await runPool(tasks, CONFIG.probeConcurrency, async function (task) {
      if (aborted) { throw new Error('aborted'); }
      var body = await fetchCommentModal(modalType, task.locator.exerciseId, task.locator.setIndex, task.date);
      var full = body ? extractFullCommentFromModalHtml(body, task.locator.preview) : null;
      if (full) {
        perDate[task.date].fulls[task.index] = full;
        progress.expansion.probeEnrichedComments++;
      }
    });

    // Serialize each day's enriched HTML back into output.
    for (var d = 0; d < dates.length; d++) {
      var date2 = dates[d];
      var entry = perDate[date2];
      var injected = 0;
      for (var k = 0; k < entry.targets.length; k++) {
        if (entry.fulls[k]) {
          entry.targets[k].setAttribute('data-full-comment', entry.fulls[k]);
          injected++;
        }
      }
      progress.expansion.processed++;
      if (injected > 0) {
        progress.expansion.enriched++;
        capturedMap[date2].html = '<!DOCTYPE html>' + entry.doc.documentElement.outerHTML;
        if (injected === entry.targets.length) {
          logEvent('expand_ok', { date: date2, got: injected, of: entry.targets.length, strategy: 'endpoint' });
        } else {
          logEvent('expand_partial', { date: date2, got: injected, of: entry.targets.length, strategy: 'endpoint' });
        }
      } else {
        progress.expansion.failures.noRecovery++;
        logEvent('expand_partial', { date: date2, got: 0, of: entry.targets.length, strategy: 'endpoint' });
      }
    }
  }

  // ------------------------------------------------------------------
  // Iframe fallback expansion (same idea as v2 but pooled and adaptive).
  // ------------------------------------------------------------------
  function findExpansionInIframe(idoc, preview) {
    var trimmed = preview.replace(/\.\.\.$/, '').trim();
    var prefixKey = trimmed.slice(0, Math.min(trimmed.length, 20));
    if (!prefixKey) { return null; }
    var candidates = idoc.querySelectorAll('body *');
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (el.children.length > 0) { continue; }
      var t = (el.textContent || '').trim();
      if (!t || t.length <= trimmed.length) { continue; }
      if (t.slice(-3) === '...') { continue; }
      if (t.indexOf(prefixKey) !== 0) { continue; }
      return t;
    }
    return null;
  }

  function dispatchEscape(idoc) {
    try {
      var ev = new KeyboardEvent('keydown', {
        key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true
      });
      idoc.dispatchEvent(ev);
      if (idoc.body) { idoc.body.dispatchEvent(ev); }
    } catch (_) {}
  }

  function createHiddenIframe() {
    var iframe = document.createElement('iframe');
    iframe.style.cssText =
      'position:fixed;left:-10000px;top:0;width:1280px;height:1800px;' +
      'border:0;pointer-events:none;opacity:0;';
    iframe.setAttribute('aria-hidden', 'true');
    document.body.appendChild(iframe);
    return iframe;
  }

  async function loadIframeUrl(iframe, url) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        if (done) { return; }
        done = true;
        reject(new Error('iframe_load_timeout'));
      }, CONFIG.expandTimeoutMs);
      iframe.onload = function () {
        if (done) { return; }
        done = true;
        clearTimeout(timer);
        resolve();
      };
      iframe.onerror = function () {
        if (done) { return; }
        done = true;
        clearTimeout(timer);
        reject(new Error('iframe_error'));
      };
      iframe.src = url;
    });
  }

  async function harvestCommentsViaIframe(iframe, dayUrl) {
    await loadIframeUrl(iframe, dayUrl);
    var idoc = iframe.contentDocument;
    if (!idoc) { throw new Error('no_content_document'); }
    var hydrated = await waitFor(
      function () { return idoc.querySelectorAll('.actuals-outcomes-container').length > 0; },
      CONFIG.expandTimeoutMs, CONFIG.iframeHydrationPollMs
    );
    if (!hydrated) { throw new Error('hydration_timeout'); }
    await sleep(300);

    var targets = collectTruncatedDescriptions(idoc);
    var results = [];
    for (var i = 0; i < targets.length; i++) {
      if (aborted) { throw new Error('aborted'); }
      var p = targets[i];
      var preview = (p.textContent || '').trim();
      var full = null;
      try { p.click(); } catch (_) {
        try { p.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); } catch (__) {}
      }
      await sleep(CONFIG.expandClickDelayMs);
      for (var poll = 0; poll < CONFIG.expandPostClickMaxPolls; poll++) {
        full = findExpansionInIframe(idoc, preview);
        if (full) { break; }
        await sleep(CONFIG.expandPostClickPollMs);
      }
      results.push(full);
      dispatchEscape(idoc);
      await sleep(CONFIG.expandModalCloseDelayMs);
    }
    return results;
  }

  async function expandOneDayViaIframe(iframe, date, month, dayHtml) {
    var dayUrl = CALENDAR_PATH + '?month=' + month + '&view=day&date=' + date;
    try {
      var fulls = await harvestCommentsViaIframe(iframe, dayUrl);
      var gotCount = 0;
      for (var i = 0; i < fulls.length; i++) { if (fulls[i]) { gotCount++; } }
      progress.expansion.processed++;
      if (gotCount === 0) {
        progress.expansion.failures.noRecovery++;
        logEvent('expand_partial', { date: date, got: 0, of: fulls.length, strategy: 'iframe' });
        return dayHtml;
      }
      progress.expansion.enriched++;
      var parser = new DOMParser();
      var doc = parser.parseFromString(dayHtml, 'text/html');
      var targets = collectTruncatedDescriptions(doc);
      for (var k = 0; k < Math.min(targets.length, fulls.length); k++) {
        if (fulls[k]) { targets[k].setAttribute('data-full-comment', fulls[k]); }
      }
      var evtType = gotCount === fulls.length ? 'expand_ok' : 'expand_partial';
      logEvent(evtType, { date: date, got: gotCount, of: fulls.length, strategy: 'iframe' });
      return '<!DOCTYPE html>' + doc.documentElement.outerHTML;
    } catch (err) {
      progress.expansion.processed++;
      if (err.message === 'aborted') { throw err; }
      if (err.message === 'hydration_timeout') { progress.expansion.failures.hydration++; }
      else if (err.message === 'iframe_load_timeout') { progress.expansion.failures.timeout++; }
      else { progress.expansion.failures.noRecovery++; }
      logEvent('expand_fail', { date: date, error: err.message });
      return dayHtml;
    }
  }

  async function expandViaIframes(capturedMap) {
    progress.expansion.strategy = 'iframe';
    var dates = Object.keys(capturedMap).filter(function (d) {
      return hasTruncatedComments(capturedMap[d].html);
    });
    progress.expansion.eligible = dates.length;
    if (dates.length === 0) { return; }

    var iframes = [];
    for (var p = 0; p < CONFIG.expandConcurrency; p++) {
      iframes.push(createHiddenIframe());
    }
    try {
      var idx = 0;
      async function worker(iframe) {
        while (idx < dates.length && !aborted) {
          var i = idx++;
          var date = dates[i];
          var entry = capturedMap[date];
          progress.current.date = date;
          try {
            entry.html = await expandOneDayViaIframe(iframe, date, entry.month, entry.html);
          } catch (err) {
            if (err.message === 'aborted') { throw err; }
          }
        }
      }
      await Promise.all(iframes.map(function (ifr) { return worker(ifr); }));
    } finally {
      iframes.forEach(function (ifr) { try { ifr.remove(); } catch (_) {} });
    }
  }

  // ------------------------------------------------------------------
  // Download
  // ------------------------------------------------------------------
  function triggerDownload(obj, filename) {
    try {
      var json = JSON.stringify(obj);
      var blob = new Blob([json], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
      return true;
    } catch (err) {
      console.log('[msb] download failed: ' + (err && err.message));
      return false;
    }
  }

  // ------------------------------------------------------------------
  // Main
  // ------------------------------------------------------------------
  async function run() {
    var range = resolveRange();
    var months = monthRange(range.start, range.end);
    progress.startedAt = Date.now();
    output.capturedAt = new Date(progress.startedAt).toISOString();
    output.capturedAtMs = progress.startedAt;
    progress.calendars.total = months.length;

    createWidget();
    startHeartbeat();

    logEvent('start', { start: range.start, end: range.end, months: months.length });

    try {
      await preflight();

      // Resume from checkpoint if one is present for this (start, end) range.
      await maybeResumeFromCheckpoint(range);
      progress.calendars.fetched = Object.keys(output.calendars).length;

      // Calendars (parallel). Skip any we already have from a checkpoint.
      progress.phase = 'calendars';
      var monthsToFetch = months.filter(function (m) { return !output.calendars[m]; });
      await runPool(monthsToFetch, CONFIG.monthConcurrency, async function (month) {
        await fetchCalendarForMonth(month);
      });
      if (aborted) { throw new Error('aborted'); }
      await flushCheckpoint();

      // Days (parallel). Any day already present in output.days from a
      // resumed checkpoint is skipped; we only fetch the missing ones.
      progress.phase = 'days';
      var allDays = [];
      for (var i = 0; i < months.length; i++) {
        var m = months[i];
        if (output.calendars[m]) {
          var dates = extractDates(output.calendars[m]);
          for (var j = 0; j < dates.length; j++) {
            allDays.push({ date: dates[j], month: m });
          }
        }
      }
      progress.days.total = allDays.length;

      var capturedMap = {};
      // Pre-seed capturedMap from checkpointed days so the expansion phase
      // sees the enriched HTML and does not re-expand already-enriched days.
      var seededDates = Object.keys(output.days);
      for (var s = 0; s < seededDates.length; s++) {
        var sd = seededDates[s];
        capturedMap[sd] = { html: output.days[sd], month: _monthForDate(sd, months) };
        progress.days.fetched++;
        progress.days.captured++;
      }
      var daysSinceFlush = 0;
      await runPool(allDays, CONFIG.dayConcurrency, async function (d) {
        if (capturedMap[d.date]) { return; }  // already have it from checkpoint
        var html = await fetchDayDetail(d.date, d.month);
        if (html) {
          capturedMap[d.date] = { html: html, month: d.month };
          output.days[d.date] = html;
          progress.days.fetched++;
          progress.days.captured++;
          progress.current.date = d.date;
          logEvent('day_ok', { date: d.date });
          daysSinceFlush++;
          if (daysSinceFlush >= CONFIG.checkpointFlushEveryDays) {
            daysSinceFlush = 0;
            await flushCheckpoint();
          }
        }
        if (CONFIG.dayDelayMs > 0) { await sleep(CONFIG.dayDelayMs).catch(function () {}); }
      });
      if (aborted) { throw new Error('aborted'); }
      await flushCheckpoint();

      // Expansion.
      if (CONFIG.expandComments) {
        progress.phase = 'expand';
        var winningModal = null;
        if (CONFIG.probeComments) {
          try { winningModal = await discoverCommentEndpoint(capturedMap); }
          catch (_) { winningModal = null; }
        }
        if (winningModal) {
          await expandViaProbe(capturedMap, winningModal);
        } else {
          await expandViaIframes(capturedMap);
        }
      }

      // Assemble output.days from capturedMap (already done incrementally,
      // but a final pass catches anything the expansion phase rewrote).
      var capturedDates = Object.keys(capturedMap);
      for (var c = 0; c < capturedDates.length; c++) {
        output.days[capturedDates[c]] = capturedMap[capturedDates[c]].html;
      }
      await flushCheckpoint();

      // Download.
      progress.phase = 'download';
      var ok = triggerDownload(output, CONFIG.downloadFilename);
      logEvent(ok ? 'download_ok' : 'download_blocked', { filename: CONFIG.downloadFilename });
      // Clear checkpoint once we have a clean final download so the next
      // run does not needlessly resume a done capture.
      try { await checkpointDelete(_checkpointKey); } catch (_) {}
      progress.phase = 'done';
      progress.elapsedMs = Date.now() - progress.startedAt;
      recomputeEta();
      logEvent('done', {
        days: progress.days.captured,
        enriched: progress.expansion.enriched,
        eligible: progress.expansion.eligible,
        strategy: progress.expansion.strategy
      });
    } catch (err) {
      if (err && err.message === 'aborted') {
        progress.aborted = true;
        progress.phase = 'aborted';
        // Persist what we have to both the checkpoint and a partial
        // download, so the user can resume or hand off the JSON.
        try {
          if (typeof capturedMap !== 'undefined') {
            var dk = Object.keys(capturedMap);
            for (var q = 0; q < dk.length; q++) { output.days[dk[q]] = capturedMap[dk[q]].html; }
          }
        } catch (_) {}
        try { await flushCheckpoint(); } catch (_) {}
        triggerDownload(output, CONFIG.partialFilename);
        logEvent('download_ok', { filename: CONFIG.partialFilename });
      } else {
        progress.fatal = err && err.message;
        progress.phase = 'failed';
        logEvent('fatal', { error: err && err.message });
      }
    } finally {
      stopHeartbeat();
      window._msbRunning = false;
      updateWidget();
    }
  }

  run();
})();
