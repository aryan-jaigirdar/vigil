/**
 * The status dashboard: one self-contained HTML page with inline CSS and JS.
 * It polls /api/status and /api/history/:check and renders everything
 * client-side, so the server never does any templating.
 */

export const DASHBOARD_HTML: string = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>vigil</title>
<style>
  :root {
    color-scheme: dark;
    --page: #0d0d0d;
    --surface: #1a1a19;
    --surface-raised: #212120;
    --ink: #ffffff;
    --ink-secondary: #c3c2b7;
    --ink-muted: #898781;
    --hairline: rgba(255, 255, 255, 0.10);
    --grid: #2c2c2a;
    --series: #3987e5;
    --good: #0ca30c;
    --bad: #d03b3b;
    --good-wash: rgba(12, 163, 12, 0.14);
    --bad-wash: rgba(208, 59, 59, 0.14);
    --muted-wash: rgba(137, 135, 129, 0.16);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--page);
    color: var(--ink);
    font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 28px 20px 48px; }
  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }
  .brand { display: flex; align-items: baseline; gap: 12px; }
  .brand h1 { margin: 0; font-size: 20px; font-weight: 650; letter-spacing: 0.08em; }
  .brand span { color: var(--ink-muted); font-size: 13px; }
  .refresh { color: var(--ink-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
  .banner {
    margin: 12px 0 20px;
    padding: 10px 14px;
    border: 1px solid var(--hairline);
    border-radius: 8px;
    background: var(--surface);
    font-size: 13px;
    color: var(--ink-secondary);
  }
  .banner.all-up { border-left: 3px solid var(--good); }
  .banner.has-down { border-left: 3px solid var(--bad); }
  .banner.offline { border-left: 3px solid var(--ink-muted); }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
    gap: 14px;
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: 10px;
    padding: 16px 16px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .card-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .card-name { font-weight: 600; font-size: 15px; overflow-wrap: anywhere; }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px 10px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 650;
    letter-spacing: 0.06em;
    white-space: nowrap;
  }
  .pill .dot { width: 7px; height: 7px; border-radius: 50%; }
  .pill.up { background: var(--good-wash); color: var(--good); }
  .pill.up .dot { background: var(--good); }
  .pill.down { background: var(--bad-wash); color: var(--bad); }
  .pill.down .dot { background: var(--bad); }
  .pill.unknown { background: var(--muted-wash); color: var(--ink-muted); }
  .pill.unknown .dot { background: var(--ink-muted); }
  .card-meta { display: flex; gap: 10px; color: var(--ink-muted); font-size: 12px; }
  .type-badge {
    padding: 0 7px;
    border: 1px solid var(--hairline);
    border-radius: 5px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    color: var(--ink-secondary);
  }
  .spark-block { border-top: 1px solid var(--grid); padding-top: 10px; }
  .spark-head {
    display: flex;
    justify-content: space-between;
    color: var(--ink-muted);
    font-size: 11px;
    margin-bottom: 4px;
  }
  .spark-head .val { color: var(--ink-secondary); font-variant-numeric: tabular-nums; }
  .spark { width: 100%; height: 48px; display: block; }
  .spark-empty {
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--ink-muted);
    font-size: 12px;
    border: 1px dashed var(--grid);
    border-radius: 6px;
  }
  .stats { display: flex; gap: 18px; }
  .stat { display: flex; flex-direction: column; gap: 1px; }
  .stat .label { color: var(--ink-muted); font-size: 11px; }
  .stat .value { font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .stat .value.na { color: var(--ink-muted); font-weight: 400; }
  .error-box {
    background: var(--surface-raised);
    border: 1px solid var(--hairline);
    border-left: 3px solid var(--bad);
    border-radius: 6px;
    padding: 7px 10px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    color: var(--ink-secondary);
    overflow-wrap: anywhere;
  }
  footer { margin-top: 28px; color: var(--ink-muted); font-size: 12px; }
  footer a { color: var(--ink-secondary); }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="brand">
      <h1>vigil</h1>
      <span>synthetic uptime monitor</span>
    </div>
    <div class="refresh" id="refresh-note">loading</div>
  </header>
  <div class="banner offline" id="banner">Loading status.</div>
  <div class="grid" id="grid"></div>
  <footer>Auto-refreshes every 10 seconds. JSON API at <a href="/api/status">/api/status</a>.</footer>
</div>
<script>
(function () {
  'use strict';

  var POLL_MS = 10000;
  var SPARK_POINTS = 60;
  var SPARK_W = 300;
  var SPARK_H = 48;
  var SPARK_PAD = 3;

  function esc(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function relTime(ts) {
    if (ts === null) return 'never';
    var s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return s + 's ago';
    var m = Math.floor(s / 60);
    if (m < 60) return m + 'm ago';
    var h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  }

  function fmtUptime(pct) {
    if (pct === null) return null;
    return (pct >= 99.995 ? '100' : pct.toFixed(2)) + '%';
  }

  function fmtLatency(ms) {
    if (ms === null) return null;
    if (ms >= 1000) return (ms / 1000).toFixed(2) + ' s';
    return Math.round(ms) + ' ms';
  }

  function pill(state) {
    var label = state === 'up' ? 'UP' : state === 'down' ? 'DOWN' : 'PENDING';
    return '<span class="pill ' + state + '"><span class="dot"></span>' + label + '</span>';
  }

  function sparkline(results) {
    if (!results || results.length < 2) {
      return '<div class="spark-empty">collecting data</div>';
    }
    var n = results.length;
    var max = 1;
    var i;
    for (i = 0; i < n; i++) {
      if (results[i].latencyMs > max) max = results[i].latencyMs;
    }
    var innerW = SPARK_W - 2 * SPARK_PAD;
    var innerH = SPARK_H - 2 * SPARK_PAD;
    var pts = [];
    for (i = 0; i < n; i++) {
      var x = SPARK_PAD + (i * innerW) / (n - 1);
      var y = SPARK_PAD + innerH - (results[i].latencyMs / max) * innerH;
      pts.push({ x: x, y: y, r: results[i] });
    }
    var path = '';
    for (i = 0; i < n; i++) {
      path += (i === 0 ? 'M' : 'L') + pts[i].x.toFixed(1) + ' ' + pts[i].y.toFixed(1);
    }
    var svg = '<svg class="spark" viewBox="0 0 ' + SPARK_W + ' ' + SPARK_H + '" role="img" aria-label="Latency sparkline">';
    svg += '<line x1="' + SPARK_PAD + '" y1="' + (SPARK_H - SPARK_PAD) + '" x2="' + (SPARK_W - SPARK_PAD) + '" y2="' + (SPARK_H - SPARK_PAD) + '" stroke="var(--grid)" stroke-width="1"/>';
    svg += '<path d="' + path + '" fill="none" stroke="var(--series)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
    for (i = 0; i < n; i++) {
      if (!pts[i].r.ok) {
        svg += '<circle cx="' + pts[i].x.toFixed(1) + '" cy="' + pts[i].y.toFixed(1) + '" r="3" fill="var(--bad)" stroke="var(--surface)" stroke-width="2"/>';
      }
    }
    // Invisible hover targets, one per sample, with native tooltips.
    var slot = SPARK_W / n;
    for (i = 0; i < n; i++) {
      var when = new Date(pts[i].r.ts).toLocaleTimeString();
      var tip = when + ' \\u00b7 ' + Math.round(pts[i].r.latencyMs) + ' ms' + (pts[i].r.ok ? '' : ' \\u00b7 failed');
      svg += '<rect x="' + (pts[i].x - slot / 2).toFixed(1) + '" y="0" width="' + slot.toFixed(1) + '" height="' + SPARK_H + '" fill="transparent"><title>' + esc(tip) + '</title></rect>';
    }
    svg += '</svg>';
    return svg;
  }

  function statHtml(label, value) {
    var na = value === null;
    return '<div class="stat"><span class="label">' + label + '</span>' +
      '<span class="value' + (na ? ' na' : '') + '">' + (na ? 'n/a' : esc(value)) + '</span></div>';
  }

  function cardHtml(check, history) {
    var html = '<div class="card">';
    html += '<div class="card-head"><span class="card-name">' + esc(check.name) + '</span>' + pill(check.state) + '</div>';
    html += '<div class="card-meta"><span class="type-badge">' + esc(check.type) + '</span><span>every ' + check.intervalSeconds + 's</span></div>';
    html += '<div class="spark-block"><div class="spark-head"><span>latency, last ' + (history ? history.length : 0) + ' checks</span>';
    var last = fmtLatency(check.lastLatencyMs);
    if (last !== null) html += '<span class="val">' + esc(last) + '</span>';
    html += '</div>' + sparkline(history) + '</div>';
    html += '<div class="stats">' +
      statHtml('uptime 24h', fmtUptime(check.uptime24h)) +
      statHtml('uptime 7d', fmtUptime(check.uptime7d)) +
      statHtml('last check', check.lastCheckedAt === null ? null : relTime(check.lastCheckedAt)) +
      '</div>';
    if (check.lastError && check.lastOk === false) {
      html += '<div class="error-box">' + esc(check.lastError) + '</div>';
    }
    html += '</div>';
    return html;
  }

  function setBanner(cls, text) {
    var banner = document.getElementById('banner');
    banner.className = 'banner ' + cls;
    banner.textContent = text;
  }

  function render(status, histories) {
    var grid = document.getElementById('grid');
    var parts = [];
    var downNames = [];
    var pending = 0;
    status.checks.forEach(function (check) {
      if (check.state === 'down') downNames.push(check.name);
      if (check.state === 'unknown') pending += 1;
      parts.push(cardHtml(check, histories[check.name]));
    });
    grid.innerHTML = parts.join('');
    var total = status.checks.length;
    if (downNames.length > 0) {
      setBanner('has-down', downNames.length + ' of ' + total + ' checks down: ' + downNames.join(', '));
    } else if (pending === total) {
      setBanner('offline', 'Waiting for first results from ' + total + ' checks.');
    } else {
      setBanner('all-up', 'All ' + (total - pending) + ' reporting checks are up.' + (pending > 0 ? ' ' + pending + ' pending.' : ''));
    }
    document.getElementById('refresh-note').textContent = 'updated ' + new Date().toLocaleTimeString();
  }

  function fetchJson(url) {
    return fetch(url, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status + ' from ' + url);
      return res.json();
    });
  }

  function refresh() {
    fetchJson('/api/status')
      .then(function (status) {
        var names = status.checks.map(function (c) { return c.name; });
        return Promise.all(
          names.map(function (name) {
            return fetchJson('/api/history/' + encodeURIComponent(name) + '?limit=' + SPARK_POINTS)
              .then(function (h) { return [name, h.results]; })
              .catch(function () { return [name, []]; });
          })
        ).then(function (entries) {
          var histories = {};
          entries.forEach(function (entry) { histories[entry[0]] = entry[1]; });
          render(status, histories);
        });
      })
      .catch(function () {
        setBanner('offline', 'Cannot reach the vigil API. Retrying.');
        document.getElementById('refresh-note').textContent = 'disconnected';
      });
  }

  refresh();
  setInterval(refresh, POLL_MS);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) refresh();
  });
})();
</script>
</body>
</html>
`;
