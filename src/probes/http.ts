import { performance } from 'node:perf_hooks';
import type { HttpCheck, ProbeResult } from '../types.js';

function describeFetchError(err: unknown, timeoutMs: number): string {
  if (err instanceof Error) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
      return `timed out after ${timeoutMs}ms`;
    }
    const cause = (err as { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message) {
      return cause.message;
    }
    return err.message;
  }
  return String(err);
}

/**
 * HTTP probe.
 *
 * Success means: the response status matches expectStatus when set, or is
 * 2xx/3xx otherwise, and the body contains the keyword when one is
 * configured. Redirects are followed unless an exact status is expected,
 * in which case the first response is judged as-is.
 */
export async function httpProbe(check: HttpCheck): Promise<ProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), check.timeoutMs);
  const start = performance.now();
  try {
    const response = await fetch(check.url, {
      method: check.method,
      redirect: check.expectStatus === null ? 'follow' : 'manual',
      signal: controller.signal,
      headers: { 'user-agent': 'vigil-probe' },
    });
    const latencyMs = Math.round(performance.now() - start);

    const statusOk =
      check.expectStatus === null
        ? response.status >= 200 && response.status < 400
        : response.status === check.expectStatus;
    if (!statusOk) {
      await response.body?.cancel().catch(() => undefined);
      const expected = check.expectStatus === null ? '2xx or 3xx' : String(check.expectStatus);
      return { ok: false, latencyMs, error: `unexpected status ${response.status}, expected ${expected}` };
    }

    if (check.keyword !== null) {
      const body = await response.text();
      if (!body.includes(check.keyword)) {
        return { ok: false, latencyMs, error: `keyword "${check.keyword}" not found in response body` };
      }
    } else {
      await response.body?.cancel().catch(() => undefined);
    }

    return { ok: true, latencyMs, error: null };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - start),
      error: describeFetchError(err, check.timeoutMs),
    };
  } finally {
    clearTimeout(timer);
  }
}
