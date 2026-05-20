// Status checker entry point. Run by .github/workflows/check.yml every 5 min,
// or locally with: node scripts/check.mjs
import { readFile, writeFile } from 'node:fs/promises';
import {
  classify, mergeBackendStatuses, buildStatus, updateUptime,
} from './lib.mjs';

// Repo root, resolved relative to this file (works on Linux CI and Windows).
const ROOT = new URL('../', import.meta.url);
const at = (rel) => new URL(rel, ROOT);

async function readJson(rel, fallback) {
  try {
    return JSON.parse(await readFile(at(rel), 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(rel, value) {
  await writeFile(at(rel), JSON.stringify(value, null, 2) + '\n');
}

/** Probe one URL. Never throws — returns a result object. */
async function probe(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    const latency = Date.now() - start;
    let body = null;
    try {
      body = await res.json();
    } catch {
      // Response was not JSON (e.g. the frontend HTML) — fine.
    }
    return { ok: true, status: res.status, latency, body };
  } catch {
    return { ok: false, status: 0, latency: Date.now() - start, body: null };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const cfg = await readJson('config.json', null);
  if (!cfg) {
    console.error('[check] config.json missing or invalid');
    process.exit(1);
  }

  const checkedAt = new Date().toISOString();

  // --- Web-App: probe the frontend URL directly ---
  const web = await probe(cfg.targets.web, cfg.timeout_ms);
  const webStatus = classify(
    web.ok, web.status, web.latency, cfg.thresholds.web_degraded_ms,
  );

  // --- Backend components: one probe of /health/components ---
  const be = await probe(cfg.targets.backend, cfg.timeout_ms);
  const beReachable = be.ok && be.status >= 200 && be.status < 300;
  const backend = mergeBackendStatuses(beReachable ? be.body : null);
  // Reachable but slow -> downgrade otherwise-operational components.
  const beSlow = beReachable && be.latency > cfg.thresholds.backend_degraded_ms;

  const components = {
    web: { status: webStatus, latency_ms: web.latency },
  };
  for (const k of ['chat', 'doku', 'voice', 'b2b']) {
    let s = backend[k];
    if (beSlow && s === 'operational') s = 'degraded';
    components[k] = { status: s, latency_ms: be.latency };
  }

  // --- Write current snapshot ---
  const status = buildStatus(checkedAt, components);
  await writeJson('data/status.json', status);

  // --- Update rolling history ---
  const uptime = await readJson('data/uptime.json', { days: [] });
  const snapshot = Object.fromEntries(
    Object.entries(components).map(([k, v]) => [k, { status: v.status }]),
  );
  const updated = updateUptime(
    uptime, checkedAt.slice(0, 10), snapshot, cfg.history_days,
  );
  await writeJson('data/uptime.json', updated);

  console.log(`[check] ${checkedAt} overall=${status.overall} ` +
    Object.entries(components).map(([k, v]) => `${k}=${v.status}`).join(' '));
}

main();
