import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classify, worst, mergeBackendStatuses, buildStatus, updateUptime,
  toMinutes, minutesInTz, inMaintenance, applyMaintenance,
} from './lib.mjs';

test('classify: 200 + fast -> operational', () => {
  assert.equal(classify(true, 200, 100, 2000), 'operational');
});

test('classify: 200 + slow -> degraded', () => {
  assert.equal(classify(true, 200, 5000, 2000), 'degraded');
});

test('classify: 503 -> down', () => {
  assert.equal(classify(true, 503, 100, 2000), 'down');
});

test('classify: network error -> down', () => {
  assert.equal(classify(false, 0, 0, 2000), 'down');
});

test('worst: picks the most severe status', () => {
  assert.equal(worst(['operational', 'down', 'degraded']), 'down');
  assert.equal(worst(['operational', 'degraded']), 'degraded');
  assert.equal(worst(['operational', 'operational']), 'operational');
});

test('worst: maintenance outranks operational but not down', () => {
  assert.equal(worst(['operational', 'maintenance']), 'maintenance');
  assert.equal(worst(['maintenance', 'down']), 'down');
});

test('mergeBackendStatuses: null body -> all four down', () => {
  assert.deepEqual(mergeBackendStatuses(null), {
    chat: 'down', doku: 'down', voice: 'down', b2b: 'down',
  });
});

test('mergeBackendStatuses: valid body -> mapped through', () => {
  const body = {
    components: {
      chat: 'operational', doku: 'degraded',
      voice: 'operational', b2b: 'operational',
    },
  };
  assert.deepEqual(mergeBackendStatuses(body), {
    chat: 'operational', doku: 'degraded',
    voice: 'operational', b2b: 'operational',
  });
});

test('mergeBackendStatuses: unknown value -> down', () => {
  assert.equal(mergeBackendStatuses({ components: { chat: 'weird' } }).chat, 'down');
});

test('buildStatus: overall is the worst component', () => {
  const s = buildStatus('2026-05-20T00:00:00Z', {
    web: { status: 'operational' },
    chat: { status: 'degraded' },
  });
  assert.equal(s.overall, 'degraded');
  assert.equal(s.checked_at, '2026-05-20T00:00:00Z');
});

test('toMinutes: parses HH:MM', () => {
  assert.equal(toMinutes('00:00'), 0);
  assert.equal(toMinutes('06:00'), 360);
  assert.equal(toMinutes('23:30'), 1410);
});

test('minutesInTz: converts UTC instant to Berlin wall-clock', () => {
  // May -> CEST (UTC+2): 01:30Z -> 03:30 Berlin
  assert.equal(minutesInTz(new Date('2026-05-21T01:30:00Z'), 'Europe/Berlin'), 210);
  // January -> CET (UTC+1): 01:30Z -> 02:30 Berlin
  assert.equal(minutesInTz(new Date('2026-01-15T01:30:00Z'), 'Europe/Berlin'), 150);
});

test('inMaintenance: inside the nightly window -> true', () => {
  const cfg = { timezone: 'Europe/Berlin', windows: [{ start: '00:00', end: '06:00' }] };
  // 01:00Z May -> 03:00 Berlin -> inside
  assert.equal(inMaintenance(new Date('2026-05-21T01:00:00Z'), cfg), true);
});

test('inMaintenance: outside the window -> false', () => {
  const cfg = { timezone: 'Europe/Berlin', windows: [{ start: '00:00', end: '06:00' }] };
  // 10:00Z May -> 12:00 Berlin -> outside
  assert.equal(inMaintenance(new Date('2026-05-21T10:00:00Z'), cfg), false);
});

test('inMaintenance: end of window is exclusive', () => {
  const cfg = { timezone: 'Europe/Berlin', windows: [{ start: '00:00', end: '06:00' }] };
  // 04:00Z May -> 06:00 Berlin -> exactly at end -> not in window
  assert.equal(inMaintenance(new Date('2026-05-21T04:00:00Z'), cfg), false);
});

test('inMaintenance: no config -> false', () => {
  assert.equal(inMaintenance(new Date(), null), false);
  assert.equal(inMaintenance(new Date(), {}), false);
});

test('applyMaintenance: reclassifies down/degraded, keeps operational', () => {
  const comps = {
    web: { status: 'operational', latency_ms: 100 },
    chat: { status: 'down', latency_ms: 5 },
    doku: { status: 'degraded', latency_ms: 9000 },
  };
  const out = applyMaintenance(comps, true);
  assert.equal(out.web.status, 'operational');
  assert.equal(out.chat.status, 'maintenance');
  assert.equal(out.doku.status, 'maintenance');
  assert.equal(out.chat.latency_ms, 5); // other fields preserved
});

test('applyMaintenance: no-op when not in a window', () => {
  const comps = { chat: { status: 'down' } };
  assert.equal(applyMaintenance(comps, false), comps);
});

test('updateUptime: creates a new day bucket', () => {
  const out = updateUptime(
    { days: [] }, '2026-05-20', { web: { status: 'operational' } }, 90,
  );
  assert.equal(out.days.length, 1);
  assert.deepEqual(out.days[0].web,
    { up: 1, degraded: 0, down: 0, maintenance: 0, total: 1 });
});

test('updateUptime: tallies a maintenance check separately', () => {
  const out = updateUptime(
    { days: [] }, '2026-05-22', { web: { status: 'maintenance' } }, 90,
  );
  assert.deepEqual(out.days[0].web,
    { up: 0, degraded: 0, down: 0, maintenance: 1, total: 1 });
});

test('updateUptime: increments an existing day bucket', () => {
  const start = {
    days: [{ date: '2026-05-20', web: { up: 1, degraded: 0, down: 0, maintenance: 0, total: 1 } }],
  };
  const out = updateUptime(start, '2026-05-20', { web: { status: 'down' } }, 90);
  assert.deepEqual(out.days[0].web,
    { up: 1, degraded: 0, down: 1, maintenance: 0, total: 2 });
});

test('updateUptime: trims history to historyDays', () => {
  const days = [];
  for (let i = 0; i < 95; i++) {
    const date = new Date(2026, 0, 1 + i).toISOString().slice(0, 10);
    days.push({ date, web: { up: 1, degraded: 0, down: 0, maintenance: 0, total: 1 } });
  }
  const out = updateUptime(
    { days }, '2026-05-20', { web: { status: 'operational' } }, 90,
  );
  assert.equal(out.days.length, 90);
});
