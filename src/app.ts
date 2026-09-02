/**
 * Application wiring: config in, running monitor out.
 *
 * Owns the store, state tracker, alert dispatcher, scheduler, HTTP server,
 * and the retention prune timer, and knows how to shut them all down.
 */

import type { Server } from 'node:http';
import { AlertDispatcher, type AlertPayload } from './alerts.js';
import type { Logger } from './logger.js';
import { Scheduler } from './scheduler.js';
import { createServer } from './server.js';
import { StateTracker, type Transition } from './state.js';
import { Store } from './store.js';
import type { Check, Config, ProbeResult } from './types.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

export interface App {
  start(): Promise<void>;
  stop(): Promise<void>;
}

function buildAlertPayload(check: Check, result: ProbeResult, transition: Transition): AlertPayload {
  return {
    event: transition.to === 'down' ? 'check.down' : 'check.up',
    check: check.name,
    checkType: check.type,
    state: transition.to,
    previousState: transition.from,
    consecutiveFailures: transition.consecutiveFailures,
    latencyMs: result.latencyMs,
    error: result.error,
    timestamp: new Date().toISOString(),
  };
}

export function createApp(config: Config, log: Logger): App {
  const store = new Store(config.databasePath);
  const tracker = new StateTracker(config.failureThreshold);
  const alerts = new AlertDispatcher(config.webhooks, 5000, log);

  const scheduler = new Scheduler({
    checks: config.checks,
    log,
    onResult(check, result) {
      store.insert(check.name, result);
      if (!result.ok) {
        log.warn(`check "${check.name}" failed in ${result.latencyMs}ms: ${result.error ?? 'unknown error'}`);
      }
      const transition = tracker.record(check.name, result.ok);
      if (transition) {
        log.info(`check "${check.name}" is ${transition.to.toUpperCase()} (was ${transition.from})`);
        void alerts.dispatch(buildAlertPayload(check, result, transition));
      }
    },
  });

  const server = createServer({ checks: config.checks, store, tracker });
  let httpServer: Server | null = null;
  let pruneTimer: NodeJS.Timeout | null = null;
  let stopped = false;

  const prune = (): void => {
    const removed = store.prune(config.retentionDays * DAY_MS);
    if (removed > 0) {
      log.info(`pruned ${removed} results older than ${config.retentionDays} days`);
    }
  };

  return {
    async start() {
      await new Promise<void>((resolve, reject) => {
        const listener = server.listen(config.port, () => {
          listener.off('error', reject);
          resolve();
        });
        listener.once('error', reject);
        httpServer = listener;
      });
      log.info(`dashboard listening on http://localhost:${config.port}`);

      prune();
      pruneTimer = setInterval(prune, PRUNE_INTERVAL_MS);

      scheduler.start();
      log.info(`scheduled ${config.checks.length} checks`);
    },

    async stop() {
      if (stopped) return;
      stopped = true;
      scheduler.stop();
      if (pruneTimer) {
        clearInterval(pruneTimer);
        pruneTimer = null;
      }
      if (httpServer) {
        const listener = httpServer;
        await new Promise<void>((resolve, reject) => {
          listener.close((err) => (err ? reject(err) : resolve()));
          listener.closeAllConnections();
        });
        httpServer = null;
      }
      store.close();
      log.info('shutdown complete');
    },
  };
}
