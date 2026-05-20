import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classify, worst, mergeBackendStatuses, buildStatus, updateUptime,
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

test('updateUptime: creates a new day bucket', () => {
  const out = updateUptime(
    { days: [] }, '2026-05-20', { web: { status: 'operational' } }, 90,
  );
  assert.equal(out.days.length, 1);
  assert.deepEqual(out.days[0].web, { up: 1, degraded: 0, down: 0, total: 1 });
});

test('updateUptime: increments an existing day bucket', () => {
  const start = {
    days: [{ date: '2026-05-20', web: { up: 1, degraded: 0, down: 0, total: 1 } }],
  };
  const out = updateUptime(start, '2026-05-20', { web: { status: 'down' } }, 90);
  assert.deepEqual(out.days[0].web, { up: 1, degraded: 0, down: 1, total: 2 });
});

test('updateUptime: trims history to historyDays', () => {
  const days = [];
  for (let i = 0; i < 95; i++) {
    const date = new Date(2026, 0, 1 + i).toISOString().slice(0, 10);
    days.push({ date, web: { up: 1, degraded: 0, down: 0, total: 1 } });
  }
  const out = updateUptime(
    { days }, '2026-05-20', { web: { status: 'operational' } }, 90,
  );
  assert.equal(out.days.length, 90);
});
