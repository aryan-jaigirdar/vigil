/**
 * Per-check up/down state machine with flap damping.
 *
 * A check starts as "unknown". A single success moves it to "up". A failure
 * only moves it to "down" once `failureThreshold` consecutive failures have
 * been observed, so a one-off blip does not page anyone. While failures are
 * accumulating below the threshold, the previous state is retained.
 *
 * Transitions are reported for unknown -> down, up -> down, and down -> up.
 * The initial unknown -> up settle is intentionally silent: a monitor
 * starting against healthy targets should not fire a wave of recovery
 * alerts.
 */

import type { CheckState } from './types.js';

export interface Transition {
  check: string;
  from: CheckState;
  to: 'up' | 'down';
  /** Consecutive failure count at the moment of the transition. */
  consecutiveFailures: number;
}

interface Entry {
  state: CheckState;
  consecutiveFailures: number;
}

export class StateTracker {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly failureThreshold: number) {
    if (!Number.isInteger(failureThreshold) || failureThreshold < 1) {
      throw new RangeError(`failureThreshold must be a positive integer, got ${failureThreshold}`);
    }
  }

  /**
   * Record one probe outcome. Returns a Transition when the check just
   * changed state in a way that should alert, or null otherwise.
   */
  record(check: string, ok: boolean): Transition | null {
    const entry = this.entries.get(check) ?? { state: 'unknown' as CheckState, consecutiveFailures: 0 };
    this.entries.set(check, entry);

    if (ok) {
      const from = entry.state;
      entry.consecutiveFailures = 0;
      entry.state = 'up';
      return from === 'down' ? { check, from, to: 'up', consecutiveFailures: 0 } : null;
    }

    entry.consecutiveFailures += 1;
    if (entry.state !== 'down' && entry.consecutiveFailures >= this.failureThreshold) {
      const from = entry.state;
      entry.state = 'down';
      return { check, from, to: 'down', consecutiveFailures: entry.consecutiveFailures };
    }
    return null;
  }

  stateOf(check: string): CheckState {
    return this.entries.get(check)?.state ?? 'unknown';
  }

  consecutiveFailuresOf(check: string): number {
    return this.entries.get(check)?.consecutiveFailures ?? 0;
  }
}
