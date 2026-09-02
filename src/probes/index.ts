import type { Check, ProbeResult } from '../types.js';
import { dnsProbe } from './dns.js';
import { httpProbe } from './http.js';
import { tcpProbe } from './tcp.js';

export { dnsProbe, httpProbe, tcpProbe };

export type ProbeRunner = (check: Check) => Promise<ProbeResult>;

/** Dispatch a check to the probe implementation for its type. */
export function runProbe(check: Check): Promise<ProbeResult> {
  switch (check.type) {
    case 'http':
      return httpProbe(check);
    case 'tcp':
      return tcpProbe(check);
    case 'dns':
      return dnsProbe(check);
  }
}
