/**
 * YAML configuration loading and validation.
 *
 * Validation is hand-rolled on purpose: the schema is small, the error
 * messages can point at the exact key that is wrong, and there is no need
 * for a schema-validation dependency.
 */

import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import yaml from 'js-yaml';
import type { Check, CheckType, Config, DnsCheck, HttpCheck, TcpCheck } from './types.js';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export const DEFAULTS = {
  port: 3080,
  databasePath: 'vigil.db',
  retentionDays: 7,
  failureThreshold: 2,
  intervalSeconds: 60,
  timeoutMs: 5000,
  httpMethod: 'GET',
} as const;

const CHECK_TYPES: readonly CheckType[] = ['http', 'tcp', 'dns'];

const TOP_LEVEL_KEYS = new Set([
  'port',
  'database',
  'retention_days',
  'failure_threshold',
  'webhooks',
  'checks',
]);

const CHECK_KEYS: Record<CheckType, Set<string>> = {
  http: new Set(['name', 'type', 'interval', 'timeout', 'url', 'method', 'expect_status', 'keyword']),
  tcp: new Set(['name', 'type', 'interval', 'timeout', 'host', 'port']),
  dns: new Set(['name', 'type', 'interval', 'timeout', 'hostname', 'expected_ip']),
};

const HTTP_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

function fail(message: string): never {
  throw new ConfigError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rejectUnknownKeys(record: Record<string, unknown>, allowed: Set<string>, where: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      fail(`${where}: unknown key "${key}"`);
    }
  }
}

function requireString(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${where} must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(value: unknown, where: string): string | null {
  if (value === undefined || value === null) return null;
  return requireString(value, where);
}

function requireInteger(value: unknown, where: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    fail(`${where} must be an integer`);
  }
  if (value < min || value > max) {
    fail(`${where} must be between ${min} and ${max}, got ${value}`);
  }
  return value;
}

function optionalInteger(
  value: unknown,
  where: string,
  min: number,
  max: number,
  fallback: number,
): number {
  if (value === undefined || value === null) return fallback;
  return requireInteger(value, where, min, max);
}

function requireHttpUrl(value: unknown, where: string): string {
  const raw = requireString(value, where);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    fail(`${where} is not a valid URL: "${raw}"`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    fail(`${where} must use http or https, got "${parsed.protocol}"`);
  }
  return raw;
}

function parseCheck(value: unknown, index: number): Check {
  const where = `checks[${index}]`;
  if (!isRecord(value)) {
    fail(`${where} must be a mapping`);
  }

  const name = requireString(value['name'], `${where}.name`);
  const type = requireString(value['type'], `${where}.type (one of ${CHECK_TYPES.join(', ')})`);
  if (!(CHECK_TYPES as readonly string[]).includes(type)) {
    fail(`${where}.type must be one of ${CHECK_TYPES.join(', ')}, got "${type}"`);
  }
  const checkType = type as CheckType;
  rejectUnknownKeys(value, CHECK_KEYS[checkType], `${where} (${name})`);

  const base = {
    name,
    intervalSeconds: optionalInteger(
      value['interval'],
      `${where}.interval`,
      1,
      86_400,
      DEFAULTS.intervalSeconds,
    ),
    timeoutMs: optionalInteger(value['timeout'], `${where}.timeout`, 1, 300_000, DEFAULTS.timeoutMs),
  };

  switch (checkType) {
    case 'http': {
      const method = (optionalString(value['method'], `${where}.method`) ?? DEFAULTS.httpMethod).toUpperCase();
      if (!HTTP_METHODS.has(method)) {
        fail(`${where}.method must be one of ${[...HTTP_METHODS].join(', ')}, got "${method}"`);
      }
      const expectStatus =
        value['expect_status'] === undefined || value['expect_status'] === null
          ? null
          : requireInteger(value['expect_status'], `${where}.expect_status`, 100, 599);
      const check: HttpCheck = {
        ...base,
        type: 'http',
        url: requireHttpUrl(value['url'], `${where}.url`),
        method,
        expectStatus,
        keyword: optionalString(value['keyword'], `${where}.keyword`),
      };
      return check;
    }
    case 'tcp': {
      const check: TcpCheck = {
        ...base,
        type: 'tcp',
        host: requireString(value['host'], `${where}.host`),
        port: requireInteger(value['port'], `${where}.port`, 1, 65_535),
      };
      return check;
    }
    case 'dns': {
      const expectedIp = optionalString(value['expected_ip'], `${where}.expected_ip`);
      if (expectedIp !== null && isIP(expectedIp) === 0) {
        fail(`${where}.expected_ip is not a valid IP address: "${expectedIp}"`);
      }
      const check: DnsCheck = {
        ...base,
        type: 'dns',
        hostname: requireString(value['hostname'], `${where}.hostname`),
        expectedIp,
      };
      return check;
    }
  }
}

function parseWebhooks(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    fail('webhooks must be a list of URLs');
  }
  return value.map((entry, index) => requireHttpUrl(entry, `webhooks[${index}]`));
}

/**
 * Parse and validate a YAML configuration document.
 * Throws ConfigError with a human-readable message on any problem.
 */
export function parseConfig(source: string): Config {
  let doc: unknown;
  try {
    doc = yaml.load(source);
  } catch (err) {
    fail(`invalid YAML: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!isRecord(doc)) {
    fail('configuration must be a YAML mapping at the top level');
  }
  rejectUnknownKeys(doc, TOP_LEVEL_KEYS, 'top level');

  const rawChecks = doc['checks'];
  if (!Array.isArray(rawChecks) || rawChecks.length === 0) {
    fail('checks must be a non-empty list');
  }
  const checks = rawChecks.map((entry, index) => parseCheck(entry, index));

  const seen = new Set<string>();
  for (const check of checks) {
    if (seen.has(check.name)) {
      fail(`duplicate check name "${check.name}", names must be unique`);
    }
    seen.add(check.name);
  }

  const database = optionalString(doc['database'], 'database') ?? DEFAULTS.databasePath;

  return {
    port: optionalInteger(doc['port'], 'port', 1, 65_535, DEFAULTS.port),
    databasePath: database,
    retentionDays: optionalInteger(doc['retention_days'], 'retention_days', 1, 3650, DEFAULTS.retentionDays),
    failureThreshold: optionalInteger(doc['failure_threshold'], 'failure_threshold', 1, 100, DEFAULTS.failureThreshold),
    webhooks: parseWebhooks(doc['webhooks']),
    checks,
  };
}

/** Read a configuration file from disk and validate it. */
export function loadConfig(path: string): Config {
  let source: string;
  try {
    source = readFileSync(path, 'utf8');
  } catch (err) {
    fail(`cannot read config file "${path}": ${err instanceof Error ? err.message : String(err)}`);
  }
  return parseConfig(source);
}
