/*
 * msb-scraper.js
 *
 * Browser-side capture script for app.mystrengthbook.com.
 *
 * MyStrengthBook does not offer a data export. This script reads the same
 * HTML pages the logged-in user's browser can already see, collects the
 * monthly calendar pages and each training day's detail page, bundles them
 * into a single JSON blob, and triggers a download.
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

  // Idempotency guard: if the script gets evaluated twice in the same tab
  // (for example via an injection wrapper that re-evaluates the IIFE), a
  // second self-invocation would race the first against the server and
  // double the request load. Short-circuit on the second call.
  if (window._msbRunning) {
    console.log('[msb] already running in this tab; ignoring this invocation.');
    return;
  }
  window._msbRunning = true;

  // ------------------------------------------------------------------
  // Config
  // ------------------------------------------------------------------
  //
  // startMonth / endMonth accept 'YYYY-MM'. Leave null to use the defaults
  // (24 months ago through the current month, inclusive). All delays are
  // milliseconds. retryCount is the number of *additional* attempts after
  // the first try for each training day.
  var CONFIG = {
    startMonth: null,
    endMonth: null,
    monthDelayMs: 200,
    dayDelayMs: 300,
    retryBackoffMs: 800,
    retryCount: 2,
    // Set to false to skip the comment-expansion pass. The pass renders each
    // day with truncated comments inside a hidden iframe and clicks each
    // preview to reveal the full text. It is slower (~2-6s per day with
    // truncated comments) but without it, comments longer than ~40 chars are
    // captured as the MSB-rendered preview and end in '...'.
    expandComments: true,
    expandTimeoutMs: 8000,
    expandClickDelayMs: 150,
    expandPostClickPollMs: 100,
    expandPostClickMaxPolls: 30,
    expandModalCloseDelayMs: 200,
    downloadFilename: 'msb_capture.json'
  };

  var CALENDAR_PATH = '/dashboard/calendar/';
  var SCHEMA_VERSION = 2;

  // ------------------------------------------------------------------
  // Small helpers
  // ------------------------------------------------------------------

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function toMonthKey(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1);
  }

  // Add `delta` months to a 'YYYY-MM' key and return the new key.
  function addMonths(monthKey, delta) {
    var parts = monthKey.split('-');
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    var d = new Date(y, m - 1 + delta, 1);
    return toMonthKey(d);
  }

  // Inclusive range of month keys from `start` through `end`.
  function monthRange(start, end) {
    var out = [];
    var cur = start;
    // Guard against swapped inputs.
    if (cur > end) { return out; }
    while (cur <= end) {
      out.push(cur);
      cur = addMonths(cur, 1);
    }
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

  // Fetch a URL as text using the logged-in session. Throws on non-2xx.
  async function fetchText(url) {
    var res = await fetch(url, { credentials: 'include' });
    if (!res.ok) {
      throw new Error('HTTP ' + res.status + ' for ' + url);
    }
    return await res.text();
  }

  // Parse training dates out of a calendar HTML page. The calendar renders
  // each training day as an element with id="select-YYYY-MM-DD" followed
  // somewhere later in the markup by an "exercises-frame" wrapper. We use a
  // non-greedy match so we only accept an id that has an exercises-frame
  // nearby in the document.
  function extractDates(calendarHtml) {
    var pattern = /id="select-(\d{4}-\d{2}-\d{2})"[\s\S]*?exercises-frame/g;
    var seen = {};
    var dates = [];
    var match;
    while ((match = pattern.exec(calendarHtml)) !== null) {
      var d = match[1];
      if (!seen[d]) {
        seen[d] = true;
        dates.push(d);
      }
    }
    dates.sort();
    return dates;
  }

  // Fetch one day's detail HTML, retrying on transient errors or missing
  // 'actuals-outcomes' marker. Returns HTML string on success, null on skip.
  async function fetchDayWithRetries(date, month) {
    var url = CALENDAR_PATH + '?month=' + month + '&view=day&date=' + date;
    var lastErr = null;

    for (var attempt = 0; attempt <= CONFIG.retryCount; attempt++) {
      try {
        var html = await fetchText(url);
        if (html.indexOf('actuals-outcomes') !== -1) {
          return html;
        }
        lastErr = new Error('missing actuals-outcomes marker');
      } catch (err) {
        lastErr = err;
      }
      if (attempt < CONFIG.retryCount) {
        await sleep(CONFIG.retryBackoffMs);
      }
    }

    console.log('[msb] skip ' + date + ' - ' + (lastErr && lastErr.message));
    return null;
  }

  // ------------------------------------------------------------------
  // Full-comment expansion
  // ------------------------------------------------------------------
  //
  // MSB ships only a ~40-character preview for each per-set comment in the
  // server-rendered HTML (long comments are truncated to a prefix followed
  // by a literal '...'). The full text is only fetched when the preview is
  // clicked. To recover it we render the day in a hidden same-origin iframe,
  // wait for React to hydrate, click each truncated preview, harvest the
  // modal/popover's full text via a MutationObserver, then inject the full
  // text back into the captured HTML as a data-full-comment attribute. The
  // Python parser prefers that attribute over the visible preview.

  // Does this day's HTML contain any server-truncated previews?
  function hasTruncatedComments(html) {
    // Cheap substring gate before walking the DOM.
    return html.indexOf('cursor:pointer') !== -1 &&
      html.indexOf('description') !== -1 &&
      html.indexOf('...</p>') !== -1;
  }

  // Matches the scraper-side predicate: a description paragraph with
  // cursor:pointer whose text content ends with '...'.
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

  // Wait up to `timeoutMs` for `predicate()` to return truthy. Polls at
  // `intervalMs`. Resolves with the predicate's return value.
  async function waitFor(predicate, timeoutMs, intervalMs) {
    intervalMs = intervalMs || 100;
    var deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        var val = predicate();
        if (val) { return val; }
      } catch (_) { /* predicate throws before DOM ready — keep polling */ }
      await sleep(intervalMs);
    }
    return null;
  }

  // After clicking a truncated preview, scan the iframe DOM for an element
  // whose text starts with the preview's prefix (minus the trailing '...')
  // but is longer than the preview and does not itself end in '...'. That is
  // the expanded copy of the comment rendered into MSB's modal or popover.
  function findExpansion(idoc, preview) {
    var trimmed = preview.replace(/\.\.\.$/, '').trim();
    // Use a generous prefix for matching: the first 20 chars are usually
    // unique enough to avoid false positives without being so long that a
    // slightly different whitespace rendering in the modal misses the match.
    var prefixKey = trimmed.slice(0, Math.min(trimmed.length, 20));
    if (!prefixKey) { return null; }

    var candidates = idoc.querySelectorAll('body *');
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      // Skip the preview element itself and elements with children that
      // contain the text (we want the innermost text holder).
      if (el.children.length > 0) { continue; }
      var t = (el.textContent || '').trim();
      if (!t || t.length <= trimmed.length) { continue; }
      if (t.slice(-3) === '...') { continue; }
      if (t.indexOf(prefixKey) !== 0) { continue; }
      return t;
    }
    return null;
  }

  // Dispatch an Escape key to close whatever modal opened for the preview.
  function dispatchEscape(idoc) {
    try {
      var ev = new KeyboardEvent('keydown', {
        key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true
      });
      idoc.dispatchEvent(ev);
      idoc.body.dispatchEvent(ev);
    } catch (_) { /* best effort */ }
  }

  // Inject the collected full-comment strings back into the original captured
  // HTML string by walking the same truncated-description elements in the
  // order they appear. Uses DOMParser so no regex against HTML is needed.
  function injectFullComments(dayHtml, fullComments) {
    try {
      var parser = new DOMParser();
      var doc = parser.parseFromString(dayHtml, 'text/html');
      var targets = collectTruncatedDescriptions(doc);
      if (targets.length !== fullComments.length) {
        console.log('[msb]   warning: expanded ' + fullComments.length +
          ' comments but original HTML has ' + targets.length +
          ' truncated previews; attribution may be off');
      }
      var n = Math.min(targets.length, fullComments.length);
      var injected = 0;
      for (var i = 0; i < n; i++) {
        if (fullComments[i]) {
          targets[i].setAttribute('data-full-comment', fullComments[i]);
          injected++;
        }
      }
      if (injected === 0) { return dayHtml; }
      // Preserve doctype — DOMParser strips it from outerHTML.
      return '<!DOCTYPE html>' + doc.documentElement.outerHTML;
    } catch (err) {
      console.log('[msb]   injection failed: ' + (err && err.message));
      return dayHtml;
    }
  }

  // Render the day URL inside an offscreen same-origin iframe, click each
  // truncated preview, collect full text. Returns an array of full-comment
  // strings (one per truncated preview, null where expansion failed).
  async function harvestFullCommentsFromIframe(dayUrl) {
    var iframe = document.createElement('iframe');
    iframe.style.cssText =
      'position:fixed;left:-10000px;top:0;width:1280px;height:1800px;' +
      'border:0;pointer-events:none;opacity:0;';
    iframe.setAttribute('aria-hidden', 'true');

    var loaded = new Promise(function (resolve, reject) {
      iframe.onload = function () { resolve(); };
      iframe.onerror = function () { reject(new Error('iframe load error')); };
    });

    document.body.appendChild(iframe);
    iframe.src = dayUrl;

    try {
      // Wait for initial load + hydration.
      await Promise.race([
        loaded,
        sleep(CONFIG.expandTimeoutMs).then(function () {
          throw new Error('iframe load timeout');
        })
      ]);
      // Wait for React to render actuals containers.
      var idoc = iframe.contentDocument;
      if (!idoc) { throw new Error('no contentDocument (cross-origin?)'); }

      var hydrated = await waitFor(function () {
        return idoc.querySelectorAll('.actuals-outcomes-container').length > 0;
      }, CONFIG.expandTimeoutMs, 200);
      if (!hydrated) { throw new Error('hydration timeout'); }
      // Extra settle time for click listeners to attach.
      await sleep(400);

      var targets = collectTruncatedDescriptions(idoc);
      var results = [];
      for (var i = 0; i < targets.length; i++) {
        var p = targets[i];
        var preview = (p.textContent || '').trim();
        var full = null;
        try {
          p.click();
        } catch (_) { /* some browsers balk at synthetic clicks on <p>; try dispatch */
          try {
            p.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          } catch (__) {}
        }
        await sleep(CONFIG.expandClickDelayMs);
        for (var attempt = 0; attempt < CONFIG.expandPostClickMaxPolls; attempt++) {
          full = findExpansion(idoc, preview);
          if (full) { break; }
          await sleep(CONFIG.expandPostClickPollMs);
        }
        results.push(full);
        dispatchEscape(idoc);
        await sleep(CONFIG.expandModalCloseDelayMs);
      }
      return results;
    } finally {
      try { iframe.remove(); } catch (_) {}
    }
  }

  async function expandCommentsForDay(date, month, dayHtml) {
    if (!hasTruncatedComments(dayHtml)) { return dayHtml; }
    var dayUrl = CALENDAR_PATH + '?month=' + month + '&view=day&date=' + date;
    try {
      var fulls = await harvestFullCommentsFromIframe(dayUrl);
      var gotCount = 0;
      for (var i = 0; i < fulls.length; i++) { if (fulls[i]) { gotCount++; } }
      if (gotCount === 0) {
        console.log('[msb]   ' + date + ': no full comments recovered');
        return dayHtml;
      }
      console.log('[msb]   ' + date + ': expanded ' + gotCount +
        ' of ' + fulls.length + ' truncated comments');
      return injectFullComments(dayHtml, fulls);
    } catch (err) {
      console.log('[msb]   ' + date + ': expand failed (' +
        (err && err.message) + '); keeping truncated previews');
      return dayHtml;
    }
  }

  // Trigger a browser download of the given object as JSON. Returns true
  // on success, false if the browser refused the programmatic click.
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

    console.log('[msb] starting capture ' + range.start + ' -> ' + range.end +
      ' (' + months.length + ' months)');
    console.log('[msb] delays: month=' + CONFIG.monthDelayMs + 'ms day=' +
      CONFIG.dayDelayMs + 'ms retries=' + CONFIG.retryCount);

    var output = {
      schemaVersion: SCHEMA_VERSION,
      capturedAt: new Date().toISOString(),
      source: 'app.mystrengthbook.com',
      calendars: {},
      days: {}
    };

    // Expose early so user can inspect partial progress and re-save
    // manually if the automatic download is blocked.
    window._msbData = output;
    window._msbDownload = function () {
      return triggerDownload(output, CONFIG.downloadFilename);
    };

    var totalDates = 0;
    var capturedDays = 0;
    var failedMonths = 0;
    var daysWithTruncated = 0;
    var daysExpanded = 0;

    for (var i = 0; i < months.length; i++) {
      var month = months[i];
      console.log('[msb] month ' + month + ' (' + (i + 1) + '/' + months.length + ')');

      var calendarHtml;
      try {
        // ?month= is mandatory; omitting it returns HTTP 500.
        calendarHtml = await fetchText(CALENDAR_PATH + '?month=' + month);
      } catch (err) {
        console.log('[msb]   calendar fetch failed: ' + err.message);
        failedMonths++;
        await sleep(CONFIG.monthDelayMs);
        continue;
      }

      output.calendars[month] = calendarHtml;

      var dates = extractDates(calendarHtml);
      totalDates += dates.length;
      console.log('[msb]   found ' + dates.length + ' training dates');

      for (var j = 0; j < dates.length; j++) {
        var date = dates[j];
        var html = await fetchDayWithRetries(date, month);
        if (html) {
          if (CONFIG.expandComments && hasTruncatedComments(html)) {
            daysWithTruncated++;
            var expanded = await expandCommentsForDay(date, month, html);
            if (expanded !== html) { daysExpanded++; }
            html = expanded;
          }
          output.days[date] = html;
          capturedDays++;
        }
        await sleep(CONFIG.dayDelayMs);
      }

      await sleep(CONFIG.monthDelayMs);
    }

    console.log('[msb] done: captured ' + capturedDays + ' of ' + totalDates +
      ' training days across ' + months.length + ' months (' +
      failedMonths + ' months failed)');
    if (CONFIG.expandComments) {
      console.log('[msb] comment expansion: enriched ' + daysExpanded +
        ' of ' + daysWithTruncated + ' days with truncated previews');
    }

    var ok = triggerDownload(output, CONFIG.downloadFilename);
    if (ok) {
      console.log('[msb] downloaded ' + CONFIG.downloadFilename);
    } else {
      console.log('[msb] automatic download blocked. Run window._msbDownload() to retry.');
    }
    console.log('[msb] data is also at window._msbData');

    return output;
  }

  run()
    .catch(function (err) {
      console.log('[msb] fatal: ' + (err && err.message));
    })
    .finally(function () {
      window._msbRunning = false;
    });
})();
