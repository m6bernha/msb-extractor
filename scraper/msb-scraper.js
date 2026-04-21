/*
 * msb-scraper.js (v4)
 *
 * Browser-side capture script for app.mystrengthbook.com.
 *
 * v4 is a ground-up rewrite around the discovery that MSB ships a
 * first-class JSON API at `app-us.mystrengthbook.com/api/v1/exercise`.
 * A single request with `utcDate[$gte]=YYYYMMDD&utcDate[$lte]=YYYYMMDD`
 * returns every exercise in that window — sets, loads, RPE, notes, the
 * works — as structured JSON. The HTML-scraping dance of v1-v3 (fetch
 * 200+ day pages, hydrate iframes to recover truncated comments, pray
 * MSB's React app cooperates) collapses into ~25 tiny fetches that
 * complete in under a minute, with no comment truncation and no iframe
 * fragility.
 *
 * Auth: the API uses an `auth: <jwt>` header instead of cookies. MSB's
 * own SPA sends that header on every request, so the scraper intercepts
 * one live MSB call at startup, lifts the JWT, and reuses it.
 *
 * Usage: open app.mystrengthbook.com while logged in, open DevTools
 * console, paste this file, press Enter. After a few seconds
 * `msb_capture.json` downloads. The data is also on window._msbData,
 * and window._msbDownload() re-saves if the browser blocks the first
 * download. The companion Python CLI (msb-extractor) consumes it.
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
    startMonth: null,
    endMonth: null,
    monthConcurrency: 5,
    monthDelayMs: 40,
    retryCount: 2,
    retryBackoffMs: 800,
    requestTimeoutMs: 20000,
    authToken: null,
    tokenCaptureTimeoutMs: 15000,
    tokenPokeIntervalMs: 1500,
    heartbeatMs: 10000,
    showWidget: true,
    downloadFilename: 'msb_capture.json',
    partialFilename: 'msb_capture_partial.json'
  };

  var API_BASE = 'https://app-us.mystrengthbook.com/api/v1';
  var SCHEMA_VERSION = 4;

  var API_FIELDS = [
    '_id', 'primary', 'secondary', 'secondaryRepMaximum',
    'primaryMuscleGroup', 'secondaryMuscleGroup', 'sets', 'repMaximums',
    'notes', 'date', 'utcDate', 'order', 'type', 'cycle', 'parameters',
    'instructions', 'nextSuperset', 'complex', 'complexName',
    'indexInComplex', 'complexInstance', 'subType', 'duration',
    'totalRounds', 'structure', 'restBetweenRounds', 'resultMeasurement',
    'ladderDirection', 'ladderIncrement', 'metconResult', 'customName'
  ];

  // Probe endpoints we know MSB ships but whose JSON shape we have not
  // pinned down yet. Each is fetched once, best-effort, after the main
  // exercise capture lands. Failures never block the primary scrape —
  // responses are stored raw under output.apiProbes so the Python side
  // can inspect them offline and grow first-class parsers next iteration.
  var PROBES = [
    { name: 'modified', path: '/modified', withDateRange: true },
    // workout-note needs an explicit userId param — MSB's server returns
    // HTTP 400 "A valid user is required" without it (2026-04-21 capture).
    { name: 'workoutNote', path: '/workout-note', withDateRange: true, withUserId: true },
    { name: 'personalRecords', path: '/personal-records', withDateRange: false }
  ];

  // ------------------------------------------------------------------
  // State exposed on window
  // ------------------------------------------------------------------
  var aborted = false;
  window._msbAbort = function () {
    aborted = true;
    logEvent('abort_requested', {});
  };

  var progress = {
    version: 4,
    phase: 'init',
    startedAt: null,
    lastEventAt: null,
    lastMessage: '',
    elapsedMs: 0,
    etaMs: null,
    aborted: false,
    fatal: null,
    months: { total: 0, fetched: 0, failed: 0 },
    probes: { total: 0, fetched: 0, failed: 0 },
    stats: { exercises: 0, sets: 0, trainingDays: 0 },
    current: { month: null }
  };
  window._msbProgress = progress;

  var events = [];
  window._msbEvents = events;

  var output = {
    schemaVersion: SCHEMA_VERSION,
    capturedAt: null,
    capturedAtMs: null,
    source: 'app.mystrengthbook.com',
    api: {
      base: API_BASE,
      userId: null,
      tokenExpires: null,
      tokenHash: null
    },
    apiMonths: {},
    apiProbes: {},
    stats: { exercises: 0, sets: 0, trainingDays: 0 }
  };
  window._msbData = output;
  window._msbDownload = function (filename) {
    return triggerDownload(output, filename || CONFIG.downloadFilename);
  };

  window._msbDiagnose = function (eventTailCount) {
    var tail = Math.max(0, Math.min(eventTailCount || 40, events.length));
    var tailStart = Math.max(0, events.length - tail);
    return {
      version: 4,
      now: Date.now(),
      running: !!window._msbRunning,
      aborted: aborted,
      progress: progress,
      config: summariseConfig(CONFIG),
      eventsTotal: events.length,
      recentEvents: events.slice(tailStart),
      outputStats: {
        months: Object.keys(output.apiMonths || {}).length,
        probes: Object.keys(output.apiProbes || {}).length,
        exercises: output.stats.exercises,
        sets: output.stats.sets,
        trainingDays: output.stats.trainingDays,
        capturedAtMs: output.capturedAtMs
      }
    };
  };

  function summariseConfig(c) {
    var keep = [
      'startMonth', 'endMonth', 'monthConcurrency',
      'retryCount', 'heartbeatMs', 'showWidget',
      'tokenCaptureTimeoutMs'
    ];
    var out = {};
    for (var i = 0; i < keep.length; i++) {
      if (c[keep[i]] !== undefined) { out[keep[i]] = c[keep[i]]; }
    }
    out.hasPresetToken = !!c.authToken;
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
    } catch (_) {}
  }

  function formatEvent(e) {
    switch (e.type) {
      case 'start':
        return 'starting v4 api-mode capture';
      case 'token_discover':
        return 'waiting up to ' + Math.round(CONFIG.tokenCaptureTimeoutMs / 1000) +
          's for MSB to issue an /api/v1 call so we can lift the auth token';
      case 'token_preset':
        return 'using preset auth token (userId=' + (e.userId || '?') + ')';
      case 'token_ok':
        return 'token captured (userId=' + (e.userId || '?') + ', expires=' + (e.expires || '?') + ')';
      case 'range':
        return 'range ' + e.start + ' → ' + e.end + ' (' + e.months + ' months)';
      case 'api_month':
        return 'month ' + e.month + ' → ' + e.exercises + ' exercises' +
          ' (' + progress.months.fetched + '/' + progress.months.total + ')';
      case 'api_month_fail':
        return 'month ' + e.month + ' FAILED: ' + e.error;
      case 'probe_ok':
        return 'probe ' + e.probe + ' → HTTP ' + e.status + ' (' + (e.size || 0) + ' bytes)';
      case 'probe_fail':
        return 'probe ' + e.probe + ' FAILED: ' + e.error + ' (non-fatal)';
      case 'heartbeat':
        return 'heartbeat phase=' + progress.phase +
          ' months=' + progress.months.fetched + '/' + progress.months.total +
          ' ex=' + progress.stats.exercises +
          ' days=' + progress.stats.trainingDays +
          ' elapsed=' + Math.round(progress.elapsedMs / 1000) + 's';
      case 'abort_requested':
        return 'abort requested — saving partial';
      case 'done':
        return 'done: ' + e.months + ' months, ' + e.exercises + ' exercises, ' +
          e.sets + ' sets, ' + e.days + ' training days in ' +
          Math.round((e.elapsedMs || 0) / 100) / 10 + 's';
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
    for (var k in e) { if (k !== 't' && k !== 'type') { out[k] = e[k]; } }
    return out;
  }

  var widgetEl = null;
  function createWidget() {
    if (!CONFIG.showWidget) { return; }
    if (document.getElementById('msb-widget')) { return; }
    widgetEl = document.createElement('div');
    widgetEl.id = 'msb-widget';
    widgetEl.style.cssText = [
      'position:fixed', 'top:12px', 'right:12px', 'z-index:2147483647',
      'min-width:280px', 'max-width:360px', 'padding:10px 12px',
      'background:rgba(15,17,21,0.94)', 'color:#e6e8ec',
      'border:1px solid #2a2f3a', 'border-radius:8px',
      'font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
      'box-shadow:0 4px 12px rgba(0,0,0,0.35)', 'pointer-events:auto'
    ].join(';');
    widgetEl.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
      '<strong style="font-family:system-ui,sans-serif;font-size:12px">MSB Extractor v4 (api)</strong>' +
      '<button id="msb-widget-abort" style="background:#3a2020;color:#f99;border:1px solid #703030;' +
      'border-radius:4px;padding:2px 8px;cursor:pointer;font-size:11px">Abort</button>' +
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
    if (progress.aborted) { lines.push('ABORTED — saving partial'); }
    if (progress.fatal) { lines.push('FATAL: ' + progress.fatal); }
    lines.push('phase:    ' + progress.phase);
    lines.push('months:   ' + progress.months.fetched + '/' + progress.months.total +
      (progress.months.failed ? ' (' + progress.months.failed + ' failed)' : ''));
    if (progress.probes.total) {
      lines.push('probes:   ' + progress.probes.fetched + '/' + progress.probes.total +
        (progress.probes.failed ? ' (' + progress.probes.failed + ' failed)' : ''));
    }
    lines.push('exercise: ' + progress.stats.exercises);
    lines.push('sets:     ' + progress.stats.sets);
    lines.push('days:     ' + progress.stats.trainingDays);
    lines.push('elapsed:  ' + Math.round(progress.elapsedMs / 1000) + 's' +
      (progress.etaMs != null ? '  eta ' + Math.round(progress.etaMs / 1000) + 's' : ''));
    body.textContent = lines.join('\n');
  }

  var heartbeatTimer = null;
  function startHeartbeat() {
    if (heartbeatTimer) { return; }
    heartbeatTimer = setInterval(function () {
      progress.elapsedMs = progress.startedAt ? Date.now() - progress.startedAt : 0;
      var done = progress.months.fetched;
      var total = progress.months.total;
      if (done > 0 && total > done && progress.elapsedMs > 500) {
        progress.etaMs = Math.round((progress.elapsedMs / done) * (total - done));
      }
      logEvent('heartbeat', {});
    }, CONFIG.heartbeatMs);
  }
  function stopHeartbeat() {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
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

  async function runPool(items, concurrency, worker) {
    var idx = 0;
    async function loop() {
      while (idx < items.length && !aborted) {
        var i = idx++;
        try { await worker(items[i], i); }
        catch (err) {
          if (err && err.message === 'aborted') { throw err; }
          if (err && err.message === 'auth_expired') { throw err; }
        }
      }
    }
    var workers = [];
    for (var k = 0; k < concurrency; k++) { workers.push(loop()); }
    await Promise.all(workers);
  }

  // ------------------------------------------------------------------
  // Auth token discovery
  // ------------------------------------------------------------------
  function extractAuthHeader(arg0, arg1) {
    try {
      if (arg0 instanceof Request) {
        var a = arg0.headers.get('auth');
        if (a) { return a; }
      }
      if (arg1 && arg1.headers) {
        if (arg1.headers instanceof Headers) {
          var b = arg1.headers.get('auth');
          if (b) { return b; }
        } else if (typeof arg1.headers === 'object') {
          return arg1.headers.auth || arg1.headers.Auth || null;
        }
      }
    } catch (_) {}
    return null;
  }

  async function discoverAuthToken() {
    if (CONFIG.authToken) {
      var preset = parseJwt(CONFIG.authToken);
      logEvent('token_preset', {
        userId: preset && preset.payload ? preset.payload.userId : null
      });
      return CONFIG.authToken;
    }

    logEvent('token_discover', {});
    return new Promise(function (resolve, reject) {
      var origFetch = window.fetch;
      var origOpen = XMLHttpRequest.prototype.open;
      var origSetHdr = XMLHttpRequest.prototype.setRequestHeader;
      var resolved = false;
      var pokeTimer = null;

      function restore() {
        try { window.fetch = origFetch; } catch (_) {}
        try { XMLHttpRequest.prototype.open = origOpen; } catch (_) {}
        try { XMLHttpRequest.prototype.setRequestHeader = origSetHdr; } catch (_) {}
        if (pokeTimer) { clearInterval(pokeTimer); pokeTimer = null; }
      }

      function gotIt(token) {
        if (resolved) { return; }
        resolved = true;
        restore();
        resolve(token);
      }

      window.fetch = function () {
        var args = Array.prototype.slice.call(arguments);
        try {
          var url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url);
          if (url && url.indexOf(API_BASE) === 0) {
            var tok = extractAuthHeader(args[0], args[1]);
            if (tok) { gotIt(tok); }
          }
        } catch (_) {}
        return origFetch.apply(this, args);
      };

      XMLHttpRequest.prototype.open = function (method, url) {
        this._msbUrl = url;
        this._msbHeaders = {};
        return origOpen.apply(this, arguments);
      };
      XMLHttpRequest.prototype.setRequestHeader = function (key, value) {
        try {
          if (this._msbHeaders) { this._msbHeaders[String(key).toLowerCase()] = String(value); }
          if (String(key).toLowerCase() === 'auth' && this._msbUrl && this._msbUrl.indexOf(API_BASE) === 0) {
            gotIt(String(value));
          }
        } catch (_) {}
        return origSetHdr.apply(this, arguments);
      };

      pokeTimer = setInterval(function () {
        if (resolved) { return; }
        try { document.dispatchEvent(new Event('visibilitychange')); } catch (_) {}
        try { window.dispatchEvent(new Event('focus')); } catch (_) {}
        try { window.dispatchEvent(new Event('online')); } catch (_) {}
      }, CONFIG.tokenPokeIntervalMs);

      setTimeout(function () {
        if (resolved) { return; }
        restore();
        reject(new Error('token_capture_timeout'));
      }, CONFIG.tokenCaptureTimeoutMs);
    });
  }

  function parseJwt(token) {
    try {
      var parts = token.split('.');
      if (parts.length < 2) { return null; }
      var payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      while (payload.length % 4) { payload += '='; }
      return JSON.parse(atob(payload));
    } catch (_) { return null; }
  }

  // ------------------------------------------------------------------
  // API fetch
  // ------------------------------------------------------------------
  function buildExerciseUrl(gte, lte) {
    var parts = ['limit=false', 'sort%5Border%5D=1', 'sort%5Bdate%5D=1'];
    for (var i = 0; i < API_FIELDS.length; i++) {
      parts.push('fields%5B' + i + '%5D=' + encodeURIComponent(API_FIELDS[i]));
    }
    parts.push('utcDate%5B%24gte%5D=' + gte);
    parts.push('utcDate%5B%24lte%5D=' + lte);
    parts.push('%24or%5B0%5D%5Bcycle%5D%5B%24exists%5D=false');
    parts.push('%24or%5B1%5D%5Bcycle.isScheduled%5D=true');
    parts.push('withThreads=true');
    return API_BASE + '/exercise?' + parts.join('&');
  }

  function monthBounds(month) {
    var p = month.split('-');
    var y = parseInt(p[0], 10);
    var m = parseInt(p[1], 10);
    var lastDay = new Date(y, m, 0).getDate();
    var gte = y + pad2(m) + '01';
    var lte = y + pad2(m) + pad2(lastDay);
    return { gte: gte, lte: lte };
  }

  async function fetchWithTimeout(url, opts, timeoutMs) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, timeoutMs);
    try {
      var merged = {};
      if (opts) {
        for (var k in opts) {
          if (Object.prototype.hasOwnProperty.call(opts, k)) { merged[k] = opts[k]; }
        }
      }
      merged.signal = ctrl.signal;
      return await fetch(url, merged);
    } finally { clearTimeout(timer); }
  }

  async function fetchMonthApi(month, token) {
    var b = monthBounds(month);
    var url = buildExerciseUrl(b.gte, b.lte);
    var lastErr = null;
    for (var attempt = 0; attempt <= CONFIG.retryCount; attempt++) {
      if (aborted) { throw new Error('aborted'); }
      try {
        var res = await fetchWithTimeout(url, {
          credentials: 'same-origin',
          headers: { auth: token }
        }, CONFIG.requestTimeoutMs);
        if (res.status === 401 || res.status === 403) {
          throw new Error('auth_expired');
        }
        if (res.ok) { return await res.json(); }
        lastErr = new Error('HTTP ' + res.status);
      } catch (err) {
        if (err && err.message === 'auth_expired') { throw err; }
        lastErr = err;
      }
      if (attempt < CONFIG.retryCount) { await sleep(CONFIG.retryBackoffMs); }
    }
    throw lastErr || new Error('month_fetch_failed');
  }

  // ------------------------------------------------------------------
  // Probe endpoints (best-effort, non-fatal)
  // ------------------------------------------------------------------
  function buildProbeUrl(probe, range, userId) {
    var url = API_BASE + probe.path;
    var params = [];
    if (probe.withDateRange && range) {
      var gte = range.start.replace('-', '') + '01';
      // resolveRange returns YYYY-MM month keys; use the full bracket of the window.
      var endParts = range.end.split('-');
      var endY = parseInt(endParts[0], 10);
      var endM = parseInt(endParts[1], 10);
      var lastDay = new Date(endY, endM, 0).getDate();
      var lte = range.end.replace('-', '') + pad2(lastDay);
      params.push('utcDate%5B%24gte%5D=' + gte);
      params.push('utcDate%5B%24lte%5D=' + lte);
    }
    if (probe.withUserId && userId) {
      params.push('userId=' + encodeURIComponent(userId));
    }
    if (params.length > 0) {
      url += '?' + params.join('&');
    }
    return url;
  }

  async function fetchProbe(probe, token, range, userId) {
    var url = buildProbeUrl(probe, range, userId);
    var record = { url: url, ok: false, status: null, contentType: null, body: null, error: null };
    try {
      var res = await fetchWithTimeout(url, {
        credentials: 'same-origin',
        headers: { auth: token }
      }, CONFIG.requestTimeoutMs);
      record.status = res.status;
      record.contentType = res.headers.get('content-type') || null;
      var text = await res.text();
      record.bytes = text.length;
      if (record.contentType && record.contentType.indexOf('application/json') !== -1) {
        try { record.body = JSON.parse(text); } catch (_) { record.body = text; }
      } else {
        // Non-JSON responses (HTML error pages etc) — store the first 2kb verbatim for diagnosis.
        record.body = text.length > 2048 ? text.slice(0, 2048) + '…[truncated]' : text;
      }
      if (res.status === 401 || res.status === 403) {
        record.error = 'auth_expired';
      } else if (!res.ok) {
        record.error = 'HTTP ' + res.status;
      } else {
        record.ok = true;
      }
    } catch (err) {
      record.error = (err && err.message) || 'unknown';
    }
    return record;
  }

  async function runProbes(token, range, userId) {
    progress.probes.total = PROBES.length;
    updateWidget();
    var tasks = PROBES.map(function (probe) {
      return (async function () {
        var rec = await fetchProbe(probe, token, range, userId);
        output.apiProbes[probe.name] = rec;
        if (rec.ok) {
          progress.probes.fetched++;
          logEvent('probe_ok', { probe: probe.name, status: rec.status, size: rec.bytes });
        } else {
          progress.probes.failed++;
          logEvent('probe_fail', { probe: probe.name, error: rec.error || ('HTTP ' + rec.status) });
        }
      })();
    });
    await Promise.all(tasks);
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
  // Stats recompute
  // ------------------------------------------------------------------
  function recomputeStats() {
    var ex = 0, sets = 0;
    var days = Object.create(null);
    var monthKeys = Object.keys(output.apiMonths);
    for (var i = 0; i < monthKeys.length; i++) {
      var raw = output.apiMonths[monthKeys[i]];
      var list = Array.isArray(raw) ? raw :
        (raw && Array.isArray(raw.docs) ? raw.docs :
          (raw && Array.isArray(raw.data) ? raw.data : []));
      for (var j = 0; j < list.length; j++) {
        var item = list[j];
        ex++;
        if (Array.isArray(item.sets)) { sets += item.sets.length; }
        var d = item.utcDate || (item.date ? String(item.date).slice(0, 10).replace(/-/g, '') : null);
        if (d) { days[d] = true; }
      }
    }
    output.stats.exercises = ex;
    output.stats.sets = sets;
    output.stats.trainingDays = Object.keys(days).length;
    progress.stats.exercises = ex;
    progress.stats.sets = sets;
    progress.stats.trainingDays = output.stats.trainingDays;
  }

  // ------------------------------------------------------------------
  // Main
  // ------------------------------------------------------------------
  async function run() {
    progress.startedAt = Date.now();
    output.capturedAt = new Date(progress.startedAt).toISOString();
    output.capturedAtMs = progress.startedAt;

    createWidget();
    startHeartbeat();
    logEvent('start', { schema: SCHEMA_VERSION });

    try {
      progress.phase = 'token';
      updateWidget();
      var token = await discoverAuthToken();
      var jwt = parseJwt(token) || {};
      var userId = jwt && jwt.payload && jwt.payload.userId;
      output.api.userId = userId || null;
      output.api.tokenExpires = jwt.expires || null;
      output.api.tokenHash = token.slice(0, 6) + '…' + token.slice(-6);
      logEvent('token_ok', { userId: userId, expires: jwt.expires });

      var range = resolveRange();
      var months = monthRange(range.start, range.end);
      progress.months.total = months.length;
      logEvent('range', { start: range.start, end: range.end, months: months.length });

      progress.phase = 'api';
      await runPool(months, CONFIG.monthConcurrency, async function (m) {
        progress.current.month = m;
        try {
          var data = await fetchMonthApi(m, token);
          output.apiMonths[m] = data;
          progress.months.fetched++;
          var list = Array.isArray(data) ? data :
            (data && data.docs ? data.docs :
              (data && data.data ? data.data : []));
          if (!window._msbApiSample && list.length > 0) {
            window._msbApiSample = list.slice(0, 2);
          }
          logEvent('api_month', { month: m, exercises: list.length });
          if (CONFIG.monthDelayMs > 0) { await sleep(CONFIG.monthDelayMs); }
          recomputeStats();
        } catch (err) {
          if (err && err.message === 'aborted') { throw err; }
          if (err && err.message === 'auth_expired') { throw err; }
          progress.months.failed++;
          logEvent('api_month_fail', { month: m, error: err && err.message });
        }
      });

      if (aborted) { throw new Error('aborted'); }
      recomputeStats();

      progress.phase = 'probes';
      updateWidget();
      try {
        await runProbes(token, range, userId);
      } catch (probeErr) {
        // Probes are best-effort. Record the failure but let the scrape finish.
        logEvent('probe_fail', { probe: '*', error: (probeErr && probeErr.message) || 'unknown' });
      }

      progress.phase = 'download';
      var ok = triggerDownload(output, CONFIG.downloadFilename);
      logEvent(ok ? 'download_ok' : 'download_blocked', { filename: CONFIG.downloadFilename });

      progress.phase = 'done';
      progress.elapsedMs = Date.now() - progress.startedAt;
      logEvent('done', {
        months: Object.keys(output.apiMonths).length,
        exercises: output.stats.exercises,
        sets: output.stats.sets,
        days: output.stats.trainingDays,
        elapsedMs: progress.elapsedMs
      });
    } catch (err) {
      if (err && err.message === 'aborted') {
        progress.aborted = true;
        progress.phase = 'aborted';
        recomputeStats();
        triggerDownload(output, CONFIG.partialFilename);
        logEvent('download_ok', { filename: CONFIG.partialFilename });
      } else if (err && err.message === 'auth_expired') {
        progress.fatal = 'auth_expired';
        progress.phase = 'failed';
        logEvent('fatal', {
          error: 'MSB rejected the auth token (401/403). Reload app.mystrengthbook.com to refresh the session, then rerun.'
        });
      } else if (err && err.message === 'token_capture_timeout') {
        progress.fatal = 'token_capture_timeout';
        progress.phase = 'failed';
        logEvent('fatal', {
          error: 'Could not auto-capture the auth token. Click any day in the MSB calendar to trigger a fresh API call, then rerun. Or set CONFIG.authToken = "<token>" before pasting.'
        });
      } else {
        progress.fatal = (err && err.message) || 'unknown';
        progress.phase = 'failed';
        logEvent('fatal', { error: progress.fatal });
      }
    } finally {
      stopHeartbeat();
      window._msbRunning = false;
      updateWidget();
    }
  }

  run();
})();
