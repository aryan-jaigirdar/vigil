import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { httpProbe, tcpProbe } from '../src/probes/index.js';
import type { HttpCheck, TcpCheck } from '../src/types.js';

let server: http.Server;
let port: number;
let closedPort: number;

function httpCheck(overrides: Partial<HttpCheck> & { url: string }): HttpCheck {
  return {
    name: 'test-http',
    type: 'http',
    intervalSeconds: 60,
    timeoutMs: 2000,
    method: 'GET',
    expectStatus: null,
    keyword: null,
    ...overrides,
  };
}

function tcpCheck(targetPort: number, overrides: Partial<TcpCheck> = {}): TcpCheck {
  return {
    name: 'test-tcp',
    type: 'tcp',
    intervalSeconds: 60,
    timeoutMs: 2000,
    host: '127.0.0.1',
    port: targetPort,
    ...overrides,
  };
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    switch (req.url) {
      case '/ok':
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('service is healthy');
        break;
      case '/slow':
        setTimeout(() => {
          res.writeHead(200);
          res.end('finally');
        }, 500);
        break;
      case '/unavailable':
        res.writeHead(503);
        res.end('maintenance');
        break;
      case '/redirect':
        res.writeHead(302, { location: '/ok' });
        res.end();
        break;
      default:
        res.writeHead(404);
        res.end('not found');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;

  // Reserve a port, then close it, so connections to it are refused.
  const throwaway = http.createServer();
  await new Promise<void>((resolve) => throwaway.listen(0, '127.0.0.1', resolve));
  closedPort = (throwaway.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) =>
    throwaway.close((err) => (err ? reject(err) : resolve())),
  );
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

describe('httpProbe', () => {
  it('succeeds on a 2xx response and measures latency', async () => {
    const result = await httpProbe(httpCheck({ url: `http://127.0.0.1:${port}/ok` }));
    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.latencyMs).toBeLessThan(2000);
  });

  it('succeeds when the keyword is present in the body', async () => {
    const result = await httpProbe(
      httpCheck({ url: `http://127.0.0.1:${port}/ok`, keyword: 'healthy' }),
    );
    expect(result.ok).toBe(true);
  });

  it('fails when the keyword is missing from the body', async () => {
    const result = await httpProbe(
      httpCheck({ url: `http://127.0.0.1:${port}/ok`, keyword: 'absent-token' }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('keyword "absent-token" not found');
  });

  it('fails on a 5xx response by default', async () => {
    const result = await httpProbe(httpCheck({ url: `http://127.0.0.1:${port}/unavailable` }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('unexpected status 503');
  });

  it('treats an exact expected status as success', async () => {
    const result = await httpProbe(
      httpCheck({ url: `http://127.0.0.1:${port}/unavailable`, expectStatus: 503 }),
    );
    expect(result.ok).toBe(true);
  });

  it('judges the first response when an exact redirect status is expected', async () => {
    const result = await httpProbe(
      httpCheck({ url: `http://127.0.0.1:${port}/redirect`, expectStatus: 302 }),
    );
    expect(result.ok).toBe(true);
  });

  it('follows redirects by default', async () => {
    const result = await httpProbe(
      httpCheck({ url: `http://127.0.0.1:${port}/redirect`, keyword: 'healthy' }),
    );
    expect(result.ok).toBe(true);
  });

  it('times out when the server is too slow', async () => {
    const result = await httpProbe(httpCheck({ url: `http://127.0.0.1:${port}/slow`, timeoutMs: 100 }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('timed out after 100ms');
  });

  it('reports connection errors', async () => {
    const result = await httpProbe(httpCheck({ url: `http://127.0.0.1:${closedPort}/ok` }));
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe('tcpProbe', () => {
  it('succeeds when the port accepts connections', async () => {
    const result = await tcpProbe(tcpCheck(port));
    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();
  });

  it('fails when the connection is refused', async () => {
    const result = await tcpProbe(tcpCheck(closedPort));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('ECONNREFUSED');
  });
});
