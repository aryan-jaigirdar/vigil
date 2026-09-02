/**
 * Interval scheduler.
 *
 * Each check runs on its own timer. First runs are staggered across a short
 * window so a restart does not fire every probe at once, and a check whose
 * probe is still in flight skips its next tick instead of stacking runs.
 */

import type { Logger } from './logger.js';
import { nullLogger } from './logger.js';
import { runProbe as defaultRunProbe, type ProbeRunner } from './probes/index.js';
import type { Check, ProbeResult } from './types.js';

export type ResultHandler = (check: Check, result: ProbeResult) => void;

export interface SchedulerOptions {
  checks: Check[];
  onResult: ResultHandler;
  /** Injectable for tests. Defaults to the real probes. */
  runProbe?: ProbeRunner;
  /** Window over which first runs are spread. Defaults to a sensible value. */
  staggerWindowMs?: number;
  log?: Logger;
}

/**
 * Evenly spread `count` start delays across `windowMs`.
 * The first delay is always 0 so the dashboard has data quickly.
 */
export function staggerDelays(count: number, windowMs: number): number[] {
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, i) => Math.round((i * windowMs) / count));
}

function defaultStaggerWindow(checks: Check[]): number {
  const minIntervalMs = Math.min(...checks.map((c) => c.intervalSeconds * 1000));
  return Math.min(15_000, minIntervalMs);
}

export class Scheduler {
  private readonly checks: Check[];
  private readonly onResult: ResultHandler;
  private readonly runProbe: ProbeRunner;
  private readonly staggerWindowMs: number;
  private readonly log: Logger;
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly inFlight = new Set<string>();
  private running = false;

  constructor(options: SchedulerOptions) {
    this.checks = options.checks;
    this.onResult = options.onResult;
    this.runProbe = options.runProbe ?? defaultRunProbe;
    this.staggerWindowMs = options.staggerWindowMs ?? defaultStaggerWindow(options.checks);
    this.log = options.log ?? nullLogger;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const delays = staggerDelays(this.checks.length, this.staggerWindowMs);
    this.checks.forEach((check, index) => {
      const startTimer = setTimeout(() => {
        void this.execute(check);
        const interval = setInterval(() => void this.execute(check), check.intervalSeconds * 1000);
        this.timers.push(interval);
      }, delays[index] ?? 0);
      this.timers.push(startTimer);
    });
  }

  stop(): void {
    this.running = false;
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.length = 0;
  }

  private async execute(check: Check): Promise<void> {
    if (!this.running) return;
    if (this.inFlight.has(check.name)) {
      this.log.warn(`check "${check.name}" is still running, skipping this tick`);
      return;
    }
    this.inFlight.add(check.name);
    try {
      const result = await this.runProbe(check);
      if (this.running) {
        this.onResult(check, result);
      }
    } catch (err) {
      // Probes are expected to catch their own errors; this is a safety net.
      const detail = err instanceof Error ? err.message : String(err);
      if (this.running) {
        this.onResult(check, { ok: false, latencyMs: 0, error: `probe crashed: ${detail}` });
      }
    } finally {
      this.inFlight.delete(check.name);
    }
  }
}
