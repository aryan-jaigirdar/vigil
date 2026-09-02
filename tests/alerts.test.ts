import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AlertDispatcher, type AlertPayload } from '../src/alerts.js';

interface Received {
  contentType: string | undefined;
  body: AlertPayload;
}

let server: http.Server;
let url: string;
const received: Received[] = [];

function samplePayload(): AlertPayload {
  return {
    event: 'check.down',
    check: 'web',
    checkType: 'http',
    state: 'down',
    previousState: 'up',
    consecutiveFailures: 2,
    latencyMs: 5000,
    error: 'timed out after 5000ms',
    timestamp: new Date().toISOString(),
  };
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      received.push({
        contentType: req.headers['content-type'],
        body: JSON.parse(Buffer.concat(chunks).toString()) as AlertPayload,
      });
      res.writeHead(200);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

describe('AlertDispatcher', () => {
  it('POSTs the payload as JSON to every webhook', async () => {
    received.length = 0;
    const dispatcher = new AlertDispatcher([url, url]);
    const payload = samplePayload();
    await dispatcher.dispatch(payload);

    expect(received).toHaveLength(2);
    const first = received[0];
    expect(first?.contentType).toBe('application/json');
    expect(first?.body).toEqual(payload);
  });

  it('does nothing with no webhooks configured', async () => {
    received.length = 0;
    const dispatcher = new AlertDispatcher([]);
    await dispatcher.dispatch(samplePayload());
    expect(received).toHaveLength(0);
  });

  it('swallows delivery failures instead of throwing', async () => {
    const dispatcher = new AlertDispatcher(['http://127.0.0.1:1/hook'], 500);
    await expect(dispatcher.dispatch(samplePayload())).resolves.toBeUndefined();
  });
});
