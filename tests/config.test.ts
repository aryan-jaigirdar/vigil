import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, parseConfig } from '../src/config.js';

const MINIMAL = `
checks:
  - name: home
    type: http
    url: https://example.com
`;

describe('parseConfig', () => {
  it('applies defaults to a minimal config', () => {
    const config = parseConfig(MINIMAL);
    expect(config.port).toBe(3080);
    expect(config.databasePath).toBe('vigil.db');
    expect(config.retentionDays).toBe(7);
    expect(config.failureThreshold).toBe(2);
    expect(config.webhooks).toEqual([]);
    expect(config.checks).toHaveLength(1);

    const check = config.checks[0];
    expect(check).toMatchObject({
      name: 'home',
      type: 'http',
      intervalSeconds: 60,
      timeoutMs: 5000,
    });
    if (check?.type !== 'http') throw new Error('expected http check');
    expect(check.method).toBe('GET');
    expect(check.expectStatus).toBeNull();
    expect(check.keyword).toBeNull();
  });

  it('parses a full config with every check type', () => {
    const config = parseConfig(`
port: 4000
database: /tmp/custom.db
retention_days: 30
failure_threshold: 3
webhooks:
  - https://hooks.example.com/a
  - https://hooks.example.com/b
checks:
  - name: api
    type: http
    url: https://api.example.com/health
    method: post
    expect_status: 204
    keyword: ready
    interval: 30
    timeout: 2000
  - name: db-port
    type: tcp
    host: db.internal
    port: 5432
  - name: apex-dns
    type: dns
    hostname: example.com
    expected_ip: 93.184.216.34
`);
    expect(config.port).toBe(4000);
    expect(config.databasePath).toBe('/tmp/custom.db');
    expect(config.retentionDays).toBe(30);
    expect(config.failureThreshold).toBe(3);
    expect(config.webhooks).toHaveLength(2);

    const [http, tcp, dns] = config.checks;
    if (http?.type !== 'http') throw new Error('expected http check');
    expect(http.method).toBe('POST');
    expect(http.expectStatus).toBe(204);
    expect(http.keyword).toBe('ready');
    expect(http.intervalSeconds).toBe(30);
    expect(http.timeoutMs).toBe(2000);

    if (tcp?.type !== 'tcp') throw new Error('expected tcp check');
    expect(tcp.host).toBe('db.internal');
    expect(tcp.port).toBe(5432);

    if (dns?.type !== 'dns') throw new Error('expected dns check');
    expect(dns.hostname).toBe('example.com');
    expect(dns.expectedIp).toBe('93.184.216.34');
  });

  it.each([
    ['not YAML mapping', 'just a string', /top level/],
    ['missing checks', 'port: 3080', /checks must be a non-empty list/],
    ['empty checks', 'checks: []', /checks must be a non-empty list/],
    ['check without name', 'checks:\n  - type: http\n    url: https://x.dev', /checks\[0\].name/],
    ['unknown check type', 'checks:\n  - name: a\n    type: icmp', /type must be one of/],
    [
      'duplicate names',
      'checks:\n  - name: a\n    type: tcp\n    host: h\n    port: 1\n  - name: a\n    type: tcp\n    host: h\n    port: 2',
      /duplicate check name "a"/,
    ],
    ['http without url', 'checks:\n  - name: a\n    type: http', /checks\[0\].url/],
    ['http with bad url', 'checks:\n  - name: a\n    type: http\n    url: "not a url"', /not a valid URL/],
    [
      'http with non-http scheme',
      'checks:\n  - name: a\n    type: http\n    url: ftp://example.com',
      /must use http or https/,
    ],
    [
      'http with bad method',
      'checks:\n  - name: a\n    type: http\n    url: https://x.dev\n    method: TRACE',
      /method must be one of/,
    ],
    [
      'http with bad expect_status',
      'checks:\n  - name: a\n    type: http\n    url: https://x.dev\n    expect_status: 99',
      /expect_status must be between 100 and 599/,
    ],
    ['tcp without port', 'checks:\n  - name: a\n    type: tcp\n    host: h', /checks\[0\].port/],
    [
      'tcp with out-of-range port',
      'checks:\n  - name: a\n    type: tcp\n    host: h\n    port: 70000',
      /port must be between 1 and 65535/,
    ],
    ['dns without hostname', 'checks:\n  - name: a\n    type: dns', /checks\[0\].hostname/],
    [
      'dns with invalid expected_ip',
      'checks:\n  - name: a\n    type: dns\n    hostname: x.dev\n    expected_ip: not-an-ip',
      /not a valid IP address/,
    ],
    [
      'zero interval',
      'checks:\n  - name: a\n    type: tcp\n    host: h\n    port: 1\n    interval: 0',
      /interval must be between/,
    ],
    ['top-level typo', `retention: 3\n${MINIMAL}`, /unknown key "retention"/],
    [
      'check-level typo',
      'checks:\n  - name: a\n    type: http\n    url: https://x.dev\n    keywrd: hi',
      /unknown key "keywrd"/,
    ],
    ['webhooks not a list', `webhooks: https://x.dev\n${MINIMAL}`, /webhooks must be a list/],
    ['webhook with bad url', `webhooks:\n  - 42\n${MINIMAL}`, /webhooks\[0\]/],
  ])('rejects %s', (_label, source, message) => {
    expect(() => parseConfig(source)).toThrowError(ConfigError);
    expect(() => parseConfig(source)).toThrowError(message);
  });

  it('rejects invalid YAML syntax', () => {
    expect(() => parseConfig('checks: [')).toThrowError(/invalid YAML/);
  });
});

describe('loadConfig', () => {
  let dir: string | null = null;

  afterEach(() => {
    if (dir !== null) {
      rmSync(dir, { recursive: true, force: true });
      dir = null;
    }
  });

  it('reads a config file from disk', () => {
    dir = mkdtempSync(join(tmpdir(), 'vigil-test-'));
    const path = join(dir, 'vigil.yaml');
    writeFileSync(path, MINIMAL);
    const config = loadConfig(path);
    expect(config.checks[0]?.name).toBe('home');
  });

  it('fails with a clear message when the file is missing', () => {
    expect(() => loadConfig('/nonexistent/vigil.yaml')).toThrowError(/cannot read config file/);
  });

  it('accepts the example config shipped with the repository', () => {
    const examplePath = fileURLToPath(new URL('../vigil.yaml', import.meta.url));
    const config = loadConfig(examplePath);
    expect(config.checks.length).toBeGreaterThanOrEqual(3);
    expect(new Set(config.checks.map((c) => c.type))).toEqual(new Set(['http', 'tcp', 'dns']));
  });
});
