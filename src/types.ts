/**
 * Shared domain types for vigil.
 */

export type CheckType = 'http' | 'tcp' | 'dns';

export interface CheckBase {
  /** Unique name, used as the identifier in storage, alerts, and the API. */
  name: string;
  type: CheckType;
  /** How often the check runs, in seconds. */
  intervalSeconds: number;
  /** Per-probe timeout, in milliseconds. */
  timeoutMs: number;
}

export interface HttpCheck extends CheckBase {
  type: 'http';
  url: string;
  /** HTTP method, uppercase. */
  method: string;
  /**
   * Exact status code the response must have. When null, any 2xx or 3xx
   * status counts as success.
   */
  expectStatus: number | null;
  /** Substring the response body must contain. Null disables the body check. */
  keyword: string | null;
  /** Extra request headers sent with the probe. Empty when none are configured. */
  headers: Record<string, string>;
}

export interface TcpCheck extends CheckBase {
  type: 'tcp';
  host: string;
  port: number;
}

export interface DnsCheck extends CheckBase {
  type: 'dns';
  hostname: string;
  /** When set, the hostname must resolve to this address. */
  expectedIp: string | null;
}

export type Check = HttpCheck | TcpCheck | DnsCheck;

export interface Config {
  /** Port the dashboard and JSON API listen on. */
  port: number;
  /** Path to the SQLite database file. */
  databasePath: string;
  /** How long raw results are kept before pruning, in days. */
  retentionDays: number;
  /** Consecutive failures required before a check is considered down. */
  failureThreshold: number;
  /** Webhook URLs that receive a JSON POST on every state transition. */
  webhooks: string[];
  checks: Check[];
}

export interface ProbeResult {
  ok: boolean;
  latencyMs: number;
  error: string | null;
}

/**
 * Lifecycle state of a check. Every check starts as "unknown" until its
 * first definitive result.
 */
export type CheckState = 'unknown' | 'up' | 'down';
