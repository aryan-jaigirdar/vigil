import { describe, expect, it } from 'vitest';
import { Scheduler, staggerDelays } from '../src/scheduler.js';
import type { Check, ProbeResult } from '../src/types.js';

function tcpCheck(name: string, intervalSeconds: number): Check {
  return { name, type: 'tcp', intervalSeconds, timeoutMs: 1000, host: '127.0.0.1', port: 1 };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('staggerDelays', () => {
  it('spreads first runs evenly across the window', () => {
    expect(staggerDelays(4, 12_000)).toEqual([0, 3000, 6000, 9000]);
  });

  it('starts the first check immediately', () => {
    expect(staggerDelays(3, 15_000)[0]).toBe(0);
  });

  it('handles empty and single-check lists', () => {
    expect(staggerDelays(0, 15_000)).toEqual([]);
    expect(staggerDelays(1, 15_000)).toEqual([0]);
  });
});

describe('Scheduler', () => {
  it('runs checks on their interval and stops cleanly', async () => {
    const results: string[] = [];
    const check = tcpCheck('fast', 1);
    // Sub-second interval through a probe stub; config enforces >= 1s but the
    // scheduler itself has no lower bound, which keeps this test quick.
    check.intervalSeconds = 0.05;

    const scheduler = new Scheduler({
      checks: [check],
      staggerWindowMs: 0,
      runProbe: (): Promise<ProbeResult> =>
        Promise.resolve({ ok: true, latencyMs: 1, error: null }),
      onResult: (c) => results.push(c.name),
    });

    scheduler.start();
    await wait(180);
    scheduler.stop();

    expect(results.length).toBeGreaterThanOrEqual(2);
    const countAfterStop = results.length;
    await wait(120);
    expect(results.length).toBe(countAfterStop);
  });

  it('does not overlap runs of the same check', async () => {
    let active = 0;
    let maxActive = 0;
    const check = tcpCheck('slow-probe', 1);
    check.intervalSeconds = 0.02;

    const scheduler = new Scheduler({
      checks: [check],
      staggerWindowMs: 0,
      runProbe: async (): Promise<ProbeResult> => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await wait(60);
        active -= 1;
        return { ok: true, latencyMs: 60, error: null };
      },
      onResult: () => undefined,
    });

    scheduler.start();
    await wait(200);
    scheduler.stop();

    expect(maxActive).toBe(1);
  });

  it('converts a crashing probe into a failed result', async () => {
    const results: ProbeResult[] = [];
    const scheduler = new Scheduler({
      checks: [tcpCheck('crash', 60)],
      staggerWindowMs: 0,
      runProbe: () => Promise.reject(new Error('unexpected explosion')),
      onResult: (_c, result) => results.push(result),
    });

    scheduler.start();
    await wait(50);
    scheduler.stop();

    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.error).toContain('unexpected explosion');
  });
});
