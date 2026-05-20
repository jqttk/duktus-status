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
var REFRESH_MS = 60000;
var HISTORY_DAYS = 90;
var STALE_MINUTES = 15;

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

// Color of one day's bar: green if clean, red if >5% down, else amber.
function bucketColor(bucket) {
  if (!bucket || bucket.total === 0) return 'none';
  if (bucket.down === 0 && bucket.degraded === 0) return 'operational';
  if (bucket.down / bucket.total > 0.05) return 'down';
  return 'degraded';
}

// Build a fixed-length array of day buckets (oldest first) for one component.
function dayBuckets(uptime, comp, days) {
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
    out.push(byDate[dt.toISOString().slice(0, 10)] || null);
  }
  return out;
}

function uptimePct(buckets) {
  var up = 0;
  var total = 0;
  for (var i = 0; i < buckets.length; i++) {
    if (buckets[i]) {
      up += buckets[i].up;
      total += buckets[i].total;
    }
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

function renderBanner(status) {
  var host = document.getElementById('banner');
  host.replaceChildren();
  host.dataset.status = status.overall;

  var titles = {
    operational: 'Alle Systeme betriebsbereit',
    degraded: 'Eingeschränkter Betrieb',
    down: 'Störung',
  };
  var icons = { operational: '✓', degraded: '!', down: '×' };

  host.append(el('span', 'banner-icon', icons[status.overall] || '!'));
  var text = el('div');
  text.append(
    el('div', 'banner-title', titles[status.overall] || 'Status unbekannt'),
    el('div', 'banner-sub', 'Aktualisiert ' + relativeTime(status.checked_at)),
  );
  host.append(text);
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

function renderComponents(status, uptime) {
  var host = document.getElementById('components');
  host.replaceChildren();

  for (var i = 0; i < ORDER.length; i++) {
    var key = ORDER[i];
    var cur = (status.components && status.components[key])
      || { status: 'down' };
    var buckets = dayBuckets(uptime, key, HISTORY_DAYS);

    var row = el('div', 'row');

    var top = el('div', 'row-top');
    var name = el('span', 'row-name');
    var dot = el('span', 'dot');
    dot.dataset.status = cur.status;
    name.append(dot, el('span', null, LABELS[key]));

    var pct = uptimePct(buckets);
    var pctText = pct === null
      ? '– Uptime'
      : pct.toFixed(2).replace('.', ',') + ' % Uptime';
    top.append(name, el('span', 'row-pct', pctText));

    var bar = el('div', 'bar');
    for (var b = 0; b < buckets.length; b++) {
      var cell = el('i');
      cell.dataset.status = bucketColor(buckets[b]);
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
  Promise.all([
    getJson('data/status.json'),
    getJson('data/uptime.json').catch(function () { return { days: [] }; }),
    getJson('data/incidents.json').catch(function () { return []; }),
  ]).then(function (results) {
    var status = results[0];
    renderBanner(status);
    renderStale(status);
    renderComponents(status, results[1]);
    renderIncidents(results[2]);
  }).catch(function () {
    var banner = document.getElementById('banner');
    banner.replaceChildren();
    banner.dataset.status = 'down';
    banner.append(el('div', 'banner-title', 'Status derzeit nicht abrufbar'));
  });
}

load();
setInterval(load, REFRESH_MS);
