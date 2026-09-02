/**
 * Webhook alert delivery.
 *
 * Every state transition produces one JSON POST per configured webhook.
 * Delivery is best-effort: failures are logged, never retried, and never
 * allowed to disturb the scheduler.
 */

import type { Logger } from './logger.js';
import { nullLogger } from './logger.js';
import type { CheckState, CheckType } from './types.js';

export interface AlertPayload {
  event: 'check.down' | 'check.up';
  check: string;
  checkType: CheckType;
  state: 'up' | 'down';
  previousState: CheckState;
  consecutiveFailures: number;
  latencyMs: number | null;
  error: string | null;
  /** ISO 8601 timestamp of the transition. */
  timestamp: string;
}

export class AlertDispatcher {
  constructor(
    private readonly webhooks: string[],
    private readonly timeoutMs = 5000,
    private readonly log: Logger = nullLogger,
  ) {}

  /** POST the payload to every webhook. Resolves once all attempts settle. */
  async dispatch(payload: AlertPayload): Promise<void> {
    await Promise.all(this.webhooks.map((url) => this.post(url, payload)));
  }

  private async post(url: string, payload: AlertPayload): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'vigil-alert',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      await response.body?.cancel().catch(() => undefined);
      if (!response.ok) {
        this.log.warn(`webhook ${url} responded ${response.status} for ${payload.event} ${payload.check}`);
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.log.warn(`webhook ${url} failed for ${payload.event} ${payload.check}: ${detail}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
