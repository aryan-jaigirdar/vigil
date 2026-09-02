import net from 'node:net';
import { performance } from 'node:perf_hooks';
import type { ProbeResult, TcpCheck } from '../types.js';

/**
 * TCP probe. Success means a TCP connection to host:port is established
 * within the timeout. The connection is closed immediately after.
 */
export function tcpProbe(check: TcpCheck): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const start = performance.now();
    let settled = false;

    const socket = net.connect({ host: check.host, port: check.port });

    const finish = (result: ProbeResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({ ok: false, latencyMs: check.timeoutMs, error: `timed out after ${check.timeoutMs}ms` });
    }, check.timeoutMs);

    socket.once('connect', () => {
      finish({ ok: true, latencyMs: Math.round(performance.now() - start), error: null });
    });

    socket.once('error', (err: Error) => {
      finish({ ok: false, latencyMs: Math.round(performance.now() - start), error: err.message });
    });
  });
}
