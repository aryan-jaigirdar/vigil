import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store.js';
import type { ProbeResult } from '../src/types.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function ok(latencyMs = 100): ProbeResult {
  return { ok: true, latencyMs, error: null };
}

function fail(error = 'boom', latencyMs = 100): ProbeResult {
  return { ok: false, latencyMs, error };
}

describe('Store', () => {
  let store: Store;
  const now = Date.UTC(2026, 0, 15, 12, 0, 0);

  beforeEach(() => {
    store = new Store(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  describe('uptime', () => {
    it('returns null when there are no results in the window', () => {
      expect(store.uptime('web', DAY_MS, now)).toBeNull();
    });

    it('computes the percentage of successful results', () => {
      store.insert('web', ok(), now - 3 * HOUR_MS);
      store.insert('web', fail(), now - 2 * HOUR_MS);
      store.insert('web', ok(), now - 1 * HOUR_MS);
      store.insert('web', ok(), now);
      expect(store.uptime('web', DAY_MS, now)).toBe(75);
    });

    it('returns 100 for all-passing and 0 for all-failing windows', () => {
      store.insert('web', ok(), now - HOUR_MS);
      store.insert('web', ok(), now);
      expect(store.uptime('web', DAY_MS, now)).toBe(100);

      store.insert('db', fail(), now - HOUR_MS);
      store.insert('db', fail(), now);
      expect(store.uptime('db', DAY_MS, now)).toBe(0);
    });

    it('excludes results outside the window', () => {
      store.insert('web', fail(), now - 2 * DAY_MS);
      store.insert('web', ok(), now - HOUR_MS);
      expect(store.uptime('web', DAY_MS, now)).toBe(100);
      // A wider window sees the old failure too.
      expect(store.uptime('web', 7 * DAY_MS, now)).toBe(50);
    });

    it('keeps checks separate', () => {
      store.insert('a', ok(), now);
      store.insert('b', fail(), now);
      expect(store.uptime('a', DAY_MS, now)).toBe(100);
      expect(store.uptime('b', DAY_MS, now)).toBe(0);
    });
  });

  describe('history and latest', () => {
    it('returns history oldest first, capped at the limit', () => {
      for (let i = 0; i < 5; i++) {
        store.insert('web', ok(100 + i), now + i * 1000);
      }
      const rows = store.history('web', 3);
      expect(rows.map((r) => r.latencyMs)).toEqual([102, 103, 104]);
      expect(rows[0]?.ts).toBeLessThan(rows[2]?.ts ?? 0);
    });

    it('round-trips ok, latency, and error fields', () => {
      store.insert('web', fail('connect ECONNREFUSED', 42), now);
      const latest = store.latest('web');
      expect(latest).toMatchObject({
        checkName: 'web',
        ts: now,
        ok: false,
        latencyMs: 42,
        error: 'connect ECONNREFUSED',
      });
    });

    it('returns null latest for an unseen check', () => {
      expect(store.latest('nope')).toBeNull();
      expect(store.history('nope')).toEqual([]);
    });
  });

  describe('prune', () => {
    it('removes only rows older than the retention window', () => {
      store.insert('web', ok(), now - 8 * DAY_MS);
      store.insert('web', ok(), now - 6 * DAY_MS);
      store.insert('web', ok(), now);
      const removed = store.prune(7 * DAY_MS, now);
      expect(removed).toBe(1);
      expect(store.history('web')).toHaveLength(2);
    });
  });
});
