import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type StatusResponse } from '../src/server.js';
import { StateTracker } from '../src/state.js';
import { Store } from '../src/store.js';
import type { Check } from '../src/types.js';

const checks: Check[] = [
  {
    name: 'web',
    type: 'http',
    intervalSeconds: 60,
    timeoutMs: 5000,
    url: 'https://example.com',
    method: 'GET',
    expectStatus: null,
    keyword: null,
  },
  { name: 'db', type: 'tcp', intervalSeconds: 30, timeoutMs: 5000, host: 'db', port: 5432 },
];

let store: Store;
let listener: Server;
let base: string;

beforeAll(async () => {
  store = new Store(':memory:');
  const tracker = new StateTracker(2);

  const now = Date.now();
  store.insert('web', { ok: true, latencyMs: 120, error: null }, now - 60_000);
  store.insert('web', { ok: false, latencyMs: 5000, error: 'timed out after 5000ms' }, now - 30_000);
  store.insert('web', { ok: true, latencyMs: 110, error: null }, now);
  tracker.record('web', true);

  const app = createServer({ checks, store, tracker });
  listener = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => listener.once('listening', resolve));
  base = `http://127.0.0.1:${(listener.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => listener.close((err) => (err ? reject(err) : resolve())));
  store.close();
});

describe('GET /api/status', () => {
  it('reports state, uptime, and the latest result per check', async () => {
    const res = await fetch(`${base}/api/status`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as StatusResponse;

    expect(body.checks).toHaveLength(2);
    const web = body.checks.find((c) => c.name === 'web');
    expect(web).toMatchObject({
      type: 'http',
      state: 'up',
      lastOk: true,
      lastLatencyMs: 110,
      lastError: null,
    });
    expect(web?.uptime24h).toBeCloseTo((2 / 3) * 100, 5);

    const db = body.checks.find((c) => c.name === 'db');
    expect(db).toMatchObject({ state: 'unknown', uptime24h: null, lastCheckedAt: null });
  });
});

describe('GET /api/history/:check', () => {
  it('returns recent results oldest first', async () => {
    const res = await fetch(`${base}/api/history/web?limit=2`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { check: string; results: { ok: boolean; latencyMs: number }[] };
    expect(body.check).toBe('web');
    expect(body.results.map((r) => r.ok)).toEqual([false, true]);
  });

  it('404s for a check that is not configured', async () => {
    const res = await fetch(`${base}/api/history/nope`);
    expect(res.status).toBe(404);
  });
});

describe('GET /', () => {
  it('serves the self-contained dashboard', async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('<title>vigil</title>');
    expect(html).toContain('/api/status');
  });
});

describe('GET /healthz', () => {
  it('responds ok', async () => {
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
