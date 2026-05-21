// Pure, I/O-free helpers for the status checker. Unit-tested by lib.test.mjs.

export const STATUSES = ['operational', 'degraded', 'down', 'maintenance'];
const RANK = { operational: 0, maintenance: 1, degraded: 2, down: 3 };

/**
 * Classify a single HTTP probe result.
 * @returns {'operational'|'degraded'|'down'}
 */
export function classify(ok, httpStatus, latencyMs, degradedThresholdMs) {
  if (!ok || httpStatus < 200 || httpStatus >= 300) return 'down';
  if (latencyMs > degradedThresholdMs) return 'degraded';
  return 'operational';
}

/** Return the most severe status from a list. */
export function worst(statuses) {
  return statuses.reduce(
    (acc, s) => (RANK[s] > RANK[acc] ? s : acc),
    'operational',
  );
}

/**
 * Map a /api/status/components response body to the four backend component
 * statuses. A null body means the backend was unreachable -> all down.
 */
export function mergeBackendStatuses(body) {
  const keys = ['chat', 'doku', 'voice', 'b2b'];
  const out = {};
  for (const k of keys) {
    const v = body && body.components && body.components[k];
    out[k] = STATUSES.includes(v) ? v : 'down';
  }
  return out;
}

/** Build the status.json snapshot object. */
export function buildStatus(checkedAt, components) {
  return {
    checked_at: checkedAt,
    overall: worst(Object.values(components).map((c) => c.status)),
    components,
  };
}

// --- maintenance windows ---

/** "HH:MM" -> minutes since midnight. */
export function toMinutes(hhmm) {
  const p = String(hhmm).split(':');
  return Number(p[0]) * 60 + Number(p[1]);
}

/** Wall-clock minutes-since-midnight of `date` in the given IANA timezone. */
export function minutesInTz(date, tz) {
  const s = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(date);
  return toMinutes(s);
}

/** True if `date` falls inside any configured maintenance window. */
export function inMaintenance(date, maintenance) {
  if (!maintenance || !Array.isArray(maintenance.windows)) return false;
  const now = minutesInTz(date, maintenance.timezone || 'UTC');
  for (const w of maintenance.windows) {
    const start = toMinutes(w.start);
    const end = toMinutes(w.end);
    if (start <= end) {
      if (now >= start && now < end) return true;
    } else if (now >= start || now < end) {
      // window crosses midnight
      return true;
    }
  }
  return false;
}

/**
 * During a maintenance window, reclassify any non-operational component
 * as 'maintenance' so a planned shutdown is not reported as an outage.
 */
export function applyMaintenance(components, isMaintenance) {
  if (!isMaintenance) return components;
  const out = {};
  for (const k of Object.keys(components)) {
    const c = components[k];
    const reclass = c.status === 'down' || c.status === 'degraded';
    out[k] = reclass ? Object.assign({}, c, { status: 'maintenance' }) : c;
  }
  return out;
}

// --- history ---

/**
 * Increment today's uptime bucket and trim the history to historyDays.
 * Maintenance checks are tallied separately and excluded from uptime %.
 */
export function updateUptime(uptime, dateStr, snapshot, historyDays) {
  const comps = Object.keys(snapshot);
  const days = Array.isArray(uptime.days) ? uptime.days.map((d) => ({ ...d })) : [];

  let bucket = days.find((d) => d.date === dateStr);
  if (!bucket) {
    bucket = { date: dateStr };
    days.push(bucket);
  }
  for (const c of comps) {
    const prev = bucket[c] || {};
    const next = {
      up: prev.up || 0,
      degraded: prev.degraded || 0,
      down: prev.down || 0,
      maintenance: prev.maintenance || 0,
      total: prev.total || 0,
    };
    const s = snapshot[c].status;
    if (s === 'operational') next.up += 1;
    else if (s === 'degraded') next.degraded += 1;
    else if (s === 'maintenance') next.maintenance += 1;
    else next.down += 1;
    next.total += 1;
    bucket[c] = next;
  }

  days.sort((a, b) => a.date.localeCompare(b.date));
  return { days: days.slice(-historyDays) };
}
