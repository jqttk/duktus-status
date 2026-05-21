'use strict';

// Render order + display labels for the five components.
var ORDER = ['web', 'chat', 'doku', 'voice', 'b2b'];
var LABELS = {
  web: 'Web-App',
  chat: 'Chat & KI',
  doku: 'Doku-Modus',
  voice: 'Voice & Transkription',
  b2b: 'B2B-API',
};
var STATUS_DE = {
  operational: 'betriebsbereit',
  degraded: 'eingeschränkt',
  down: 'Störung',
  none: 'keine Daten',
};
var REFRESH_MS = 60000;
var HISTORY_DAYS = 90;
var STALE_MINUTES = 15;
var SVG_NS = 'http://www.w3.org/2000/svg';

// First paint animates; refreshes (every 60s) do not.
var firstPaint = true;

function getJson(path) {
  // Cache-bust so an open tab always sees the latest committed data.
  return fetch(path + '?t=' + Date.now()).then(function (res) {
    if (!res.ok) throw new Error(path + ' ' + res.status);
    return res.json();
  });
}

function relativeTime(iso) {
  var min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'gerade eben';
  if (min === 1) return 'vor 1 Minute';
  if (min < 60) return 'vor ' + min + ' Minuten';
  var h = Math.round(min / 60);
  return h === 1 ? 'vor 1 Stunde' : 'vor ' + h + ' Stunden';
}

function formatDate(key) {
  var p = key.split('-');
  return p[2] + '.' + p[1] + '.' + p[0];
}

// Color of one day's bar: green if clean, red if >5% down, else amber.
function bucketColor(bucket) {
  if (!bucket || bucket.total === 0) return 'none';
  if (bucket.down === 0 && bucket.degraded === 0) return 'operational';
  if (bucket.down / bucket.total > 0.05) return 'down';
  return 'degraded';
}

// Fixed-length array of { key, bucket } for one component, oldest first.
function dayCells(uptime, comp, days) {
  var byDate = {};
  var list = (uptime && uptime.days) || [];
  for (var i = 0; i < list.length; i++) {
    byDate[list[i].date] = list[i][comp] || null;
  }
  var out = [];
  var today = new Date();
  for (var d = days - 1; d >= 0; d--) {
    var dt = new Date(today);
    dt.setDate(today.getDate() - d);
    var key = dt.toISOString().slice(0, 10);
    out.push({ key: key, bucket: byDate[key] || null });
  }
  return out;
}

function uptimePct(cells) {
  var up = 0;
  var total = 0;
  for (var i = 0; i < cells.length; i++) {
    var b = cells[i].bucket;
    if (b) { up += b.up; total += b.total; }
  }
  if (total === 0) return null;
  return (up / total) * 100;
}

function el(tag, className, text) {
  var node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function statusIcon(kind) {
  var svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  var d = kind === 'operational' ? 'M5 12.5l4.2 4.2L19 7'
    : kind === 'down' ? 'M7 7l10 10M17 7L7 17'
    : 'M12 6.5v7.5M12 17.4v.1';
  var path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2.6');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  return svg;
}

function renderBanner(status, animate) {
  var host = document.getElementById('banner');
  host.replaceChildren();
  host.dataset.status = status.overall;
  host.classList.toggle('banner--in', animate);

  var titles = {
    operational: 'Alle Systeme betriebsbereit',
    degraded: 'Eingeschränkter Betrieb',
    down: 'Störung',
  };

  var icon = el('span', 'banner-icon');
  icon.appendChild(statusIcon(status.overall));

  var text = el('div');
  text.append(
    el('div', 'banner-title', titles[status.overall] || 'Status unbekannt'),
    el('div', 'banner-sub', 'Aktualisiert ' + relativeTime(status.checked_at)),
  );
  host.append(icon, text);
}

function renderStale(status) {
  var host = document.getElementById('stale');
  var ageMin = (Date.now() - new Date(status.checked_at).getTime()) / 60000;
  if (ageMin > STALE_MINUTES) {
    host.textContent = 'Hinweis: Die Statusdaten sind möglicherweise '
      + 'veraltet (letzte Prüfung ' + relativeTime(status.checked_at) + ').';
    host.hidden = false;
  } else {
    host.hidden = true;
  }
}

function renderComponents(status, uptime, animate) {
  var host = document.getElementById('components');
  host.replaceChildren();

  for (var i = 0; i < ORDER.length; i++) {
    var key = ORDER[i];
    var cur = (status.components && status.components[key]) || { status: 'down' };
    var cells = dayCells(uptime, key, HISTORY_DAYS);
    var pct = uptimePct(cells);
    var pctText = pct === null
      ? '– Uptime'
      : pct.toFixed(2).replace('.', ',') + ' % Uptime';

    var row = el('div', animate ? 'row row--in' : 'row');
    row.style.setProperty('--i', i);
    row.setAttribute('role', 'listitem');
    row.setAttribute('aria-label',
      LABELS[key] + ': ' + STATUS_DE[cur.status] + ', ' + pctText);

    var top = el('div', 'row-top');
    var name = el('span', 'row-name');
    var dot = el('span', 'dot');
    dot.dataset.status = cur.status;
    dot.setAttribute('aria-hidden', 'true');
    name.append(dot, el('span', null, LABELS[key]));
    top.append(name, el('span', 'row-pct', pctText));

    var bar = el('div', 'bar');
    bar.setAttribute('aria-hidden', 'true');
    for (var c = 0; c < cells.length; c++) {
      var color = bucketColor(cells[c].bucket);
      var cell = el('i');
      cell.dataset.status = color;
      cell.title = formatDate(cells[c].key) + ' — ' + STATUS_DE[color];
      bar.append(cell);
    }

    row.append(top, bar);
    host.append(row);
  }
}

function renderIncidents(incidents) {
  var host = document.getElementById('incidents');
  host.replaceChildren();

  if (!incidents || incidents.length === 0) {
    host.append(el('div', 'incident-empty',
      'Keine Störungen in den letzten 14 Tagen gemeldet.'));
    return;
  }

  for (var i = 0; i < incidents.length; i++) {
    var inc = incidents[i];
    var card = el('article', 'incident');
    card.dataset.severity = inc.severity || 'degraded';

    var head = el('div', 'incident-head');
    head.append(
      el('span', 'incident-title', inc.title || 'Störung'),
      el('span', 'incident-date',
        (inc.date || '') + (inc.resolved ? ' · behoben' : ' · aktiv')),
    );
    card.append(head);

    var updates = inc.updates || [];
    for (var u = 0; u < updates.length; u++) {
      var line = el('div', 'incident-update');
      line.append(
        el('span', 'incident-time', updates[u].time || ''),
        el('span', null, updates[u].text || ''),
      );
      card.append(line);
    }
    host.append(card);
  }
}

function load() {
  var animate = firstPaint;
  Promise.all([
    getJson('data/status.json'),
    getJson('data/uptime.json').catch(function () { return { days: [] }; }),
    getJson('data/incidents.json').catch(function () { return []; }),
  ]).then(function (results) {
    renderBanner(results[0], animate);
    renderStale(results[0]);
    renderComponents(results[0], results[1], animate);
    renderIncidents(results[2]);
    firstPaint = false;
  }).catch(function () {
    var banner = document.getElementById('banner');
    banner.replaceChildren();
    banner.dataset.status = 'down';
    banner.append(el('div', 'banner-title', 'Status derzeit nicht abrufbar'));
  });
}

load();
setInterval(load, REFRESH_MS);
