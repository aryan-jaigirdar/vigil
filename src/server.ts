/**
 * Express server: the status dashboard and the JSON API behind it.
 *
 * GET /                   the dashboard (self-contained HTML)
 * GET /api/status         current state, uptime, and last result per check
 * GET /api/history/:check recent results for one check (for sparklines)
 * GET /healthz            liveness endpoint for monitoring the monitor
 */

import express, { type Express } from 'express';
import { DASHBOARD_HTML } from './dashboard.js';
import type { StateTracker } from './state.js';
import type { Store } from './store.js';
import type { Check, CheckState, CheckType } from './types.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_DEFAULT_LIMIT = 120;
const HISTORY_MAX_LIMIT = 500;

export interface CheckStatus {
  name: string;
  type: CheckType;
  state: CheckState;
  intervalSeconds: number;
  uptime24h: number | null;
  uptime7d: number | null;
  lastCheckedAt: number | null;
  lastLatencyMs: number | null;
  lastOk: boolean | null;
  lastError: string | null;
}

export interface StatusResponse {
  generatedAt: string;
  checks: CheckStatus[];
}

export interface ServerDeps {
  checks: Check[];
  store: Store;
  tracker: StateTracker;
}

function parseLimit(raw: unknown): number {
  if (typeof raw !== 'string') return HISTORY_DEFAULT_LIMIT;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) return HISTORY_DEFAULT_LIMIT;
  return Math.min(Math.max(value, 1), HISTORY_MAX_LIMIT);
}

export function createServer(deps: ServerDeps): Express {
  const { checks, store, tracker } = deps;
  const byName = new Map(checks.map((check) => [check.name, check]));
  const app = express();
  app.disable('x-powered-by');

  app.get('/', (_req, res) => {
    res.type('html').send(DASHBOARD_HTML);
  });

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/status', (_req, res) => {
    const body: StatusResponse = {
      generatedAt: new Date().toISOString(),
      checks: checks.map((check) => {
        const latest = store.latest(check.name);
        return {
          name: check.name,
          type: check.type,
          state: tracker.stateOf(check.name),
          intervalSeconds: check.intervalSeconds,
          uptime24h: store.uptime(check.name, DAY_MS),
          uptime7d: store.uptime(check.name, 7 * DAY_MS),
          lastCheckedAt: latest?.ts ?? null,
          lastLatencyMs: latest?.latencyMs ?? null,
          lastOk: latest ? latest.ok : null,
          lastError: latest?.error ?? null,
        };
      }),
    };
    res.json(body);
  });

  app.get('/api/history/:check', (req, res) => {
    const name = req.params.check;
    if (!byName.has(name)) {
      res.status(404).json({ error: `unknown check "${name}"` });
      return;
    }
    const limit = parseLimit(req.query['limit']);
    const results = store.history(name, limit).map((row) => ({
      ts: row.ts,
      ok: row.ok,
      latencyMs: row.latencyMs,
    }));
    res.json({ check: name, results });
  });

  return app;
}
