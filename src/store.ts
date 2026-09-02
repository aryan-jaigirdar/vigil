/**
 * SQLite-backed result storage.
 *
 * One table of raw probe results, indexed by (check_name, ts). Uptime is
 * computed on demand with an aggregate query, and old rows are pruned
 * periodically to honor the retention window.
 */

import Database from 'better-sqlite3';
import type { ProbeResult } from './types.js';

export interface ResultRow {
  checkName: string;
  /** Epoch milliseconds. */
  ts: number;
  ok: boolean;
  latencyMs: number;
  error: string | null;
}

interface RawRow {
  check_name: string;
  ts: number;
  ok: number;
  latency_ms: number;
  error: string | null;
}

interface UptimeRow {
  total: number;
  up: number | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  check_name TEXT NOT NULL,
  ts INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  latency_ms REAL NOT NULL,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_results_check_ts ON results (check_name, ts);
`;

function toResultRow(raw: RawRow): ResultRow {
  return {
    checkName: raw.check_name,
    ts: raw.ts,
    ok: raw.ok === 1,
    latencyMs: raw.latency_ms,
    error: raw.error,
  };
}

export class Store {
  private readonly db: Database.Database;
  private readonly insertStmt: Database.Statement;
  private readonly historyStmt: Database.Statement;
  private readonly latestStmt: Database.Statement;
  private readonly uptimeStmt: Database.Statement;
  private readonly pruneStmt: Database.Statement;

  /** Pass ":memory:" for an ephemeral database (used in tests). */
  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.exec(SCHEMA);

    this.insertStmt = this.db.prepare(
      'INSERT INTO results (check_name, ts, ok, latency_ms, error) VALUES (?, ?, ?, ?, ?)',
    );
    this.historyStmt = this.db.prepare(
      'SELECT check_name, ts, ok, latency_ms, error FROM results WHERE check_name = ? ORDER BY ts DESC, id DESC LIMIT ?',
    );
    this.latestStmt = this.db.prepare(
      'SELECT check_name, ts, ok, latency_ms, error FROM results WHERE check_name = ? ORDER BY ts DESC, id DESC LIMIT 1',
    );
    this.uptimeStmt = this.db.prepare(
      'SELECT COUNT(*) AS total, SUM(ok) AS up FROM results WHERE check_name = ? AND ts >= ?',
    );
    this.pruneStmt = this.db.prepare('DELETE FROM results WHERE ts < ?');
  }

  insert(checkName: string, result: ProbeResult, ts: number = Date.now()): void {
    this.insertStmt.run(checkName, ts, result.ok ? 1 : 0, result.latencyMs, result.error);
  }

  /** Most recent results for a check, oldest first. */
  history(checkName: string, limit = 100): ResultRow[] {
    const rows = this.historyStmt.all(checkName, limit) as RawRow[];
    return rows.reverse().map(toResultRow);
  }

  latest(checkName: string): ResultRow | null {
    const raw = this.latestStmt.get(checkName) as RawRow | undefined;
    return raw ? toResultRow(raw) : null;
  }

  /**
   * Uptime percentage (0 to 100) over the trailing window, or null when
   * there are no results in the window yet.
   */
  uptime(checkName: string, windowMs: number, now: number = Date.now()): number | null {
    const row = this.uptimeStmt.get(checkName, now - windowMs) as UptimeRow;
    if (row.total === 0) return null;
    return ((row.up ?? 0) / row.total) * 100;
  }

  /** Delete results older than the retention window. Returns rows removed. */
  prune(retentionMs: number, now: number = Date.now()): number {
    return this.pruneStmt.run(now - retentionMs).changes;
  }

  close(): void {
    this.db.close();
  }
}
