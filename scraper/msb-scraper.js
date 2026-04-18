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
    downloadFilename: 'msb_capture.json'
  };

  var CALENDAR_PATH = '/dashboard/calendar/';

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
      schemaVersion: 1,
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
