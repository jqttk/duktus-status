// Pure, I/O-free helpers for the status checker. Unit-tested by lib.test.mjs.

export const STATUSES = ['operational', 'degraded', 'down'];
const RANK = { operational: 0, degraded: 1, down: 2 };

/**
 * Classify a single HTTP probe result.
 * @param {boolean} ok        - request completed (no network error / timeout)
 * @param {number}  httpStatus
 * @param {number}  latencyMs
 * @param {number}  degradedThresholdMs
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
 * Map a /health/components response body to the four backend component
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

/**
 * Increment today's uptime bucket and trim the history to historyDays.
 * @param {{days: Array}} uptime  - existing uptime.json content
 * @param {string} dateStr        - YYYY-MM-DD for today
 * @param {Object} snapshot       - { web: {status}, chat: {status}, ... }
 * @param {number} historyDays
 * @returns {{days: Array}} a new uptime object (input is not mutated destructively)
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
    const prev = bucket[c] || { up: 0, degraded: 0, down: 0, total: 0 };
    const next = { ...prev };
    const s = snapshot[c].status;
    if (s === 'operational') next.up += 1;
    else if (s === 'degraded') next.degraded += 1;
    else next.down += 1;
    next.total += 1;
    bucket[c] = next;
  }

  days.sort((a, b) => a.date.localeCompare(b.date));
  return { days: days.slice(-historyDays) };
}
