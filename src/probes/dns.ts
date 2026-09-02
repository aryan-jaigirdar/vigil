import { Resolver } from 'node:dns/promises';
import { performance } from 'node:perf_hooks';
import type { DnsCheck, ProbeResult } from '../types.js';

function errorCode(err: unknown): string | null {
  if (err instanceof Error && typeof (err as NodeJS.ErrnoException).code === 'string') {
    return (err as NodeJS.ErrnoException).code ?? null;
  }
  return null;
}

/**
 * DNS probe. Resolves A records for the hostname, falling back to AAAA when
 * the name exists but has no A records. Success means at least one address
 * came back, and, when expectedIp is set, that it is among the answers.
 */
export async function dnsProbe(check: DnsCheck): Promise<ProbeResult> {
  const resolver = new Resolver({ timeout: check.timeoutMs, tries: 1 });
  const start = performance.now();
  try {
    let addresses: string[];
    try {
      addresses = await resolver.resolve4(check.hostname);
    } catch (err) {
      if (errorCode(err) === 'ENODATA') {
        addresses = await resolver.resolve6(check.hostname);
      } else {
        throw err;
      }
    }
    const latencyMs = Math.round(performance.now() - start);

    if (addresses.length === 0) {
      return { ok: false, latencyMs, error: `no addresses returned for ${check.hostname}` };
    }
    if (check.expectedIp !== null && !addresses.includes(check.expectedIp)) {
      return {
        ok: false,
        latencyMs,
        error: `resolved to ${addresses.join(', ')}, expected ${check.expectedIp}`,
      };
    }
    return { ok: true, latencyMs, error: null };
  } catch (err) {
    const code = errorCode(err);
    const detail = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - start),
      error: code === 'ETIMEOUT' ? `timed out after ${check.timeoutMs}ms` : detail,
    };
  }
}
