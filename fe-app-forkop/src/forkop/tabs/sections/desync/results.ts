import type { DesyncResult } from './api';

// Repeated probes measure stability; absent protocol/speed results remain absent.
export function summarizeDesyncResults(probes: DesyncResult[]): DesyncResult[] {
  const groups = new Map<string, DesyncResult[]>();
  for (const probe of probes) {
    const key =
      probe.candidate === undefined
        ? JSON.stringify(probe.options)
        : String(probe.candidate);
    const group = groups.get(key) || [];
    group.push(probe);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    const passed = group.filter((result) => result.success);
    const mean = (key: 'latency_ms' | 'throughput_bps') => {
      const values = passed
        .map((result) => result[key])
        .filter(
          (value): value is number =>
            typeof value === 'number' && Number.isFinite(value),
        );
      return values.length
        ? Math.round(
            (values.reduce((sum, value) => sum + value, 0) / values.length) *
              100,
          ) / 100
        : undefined;
    };
    const tested = (protocol: 'tls' | 'http' | 'quic') => {
      const attempts = group.filter(
        (result) =>
          result.protocol === protocol ||
          (protocol === 'tls' && result.tls_version),
      );
      return attempts.length
        ? attempts.some((result) => result.success)
        : undefined;
    };
    return {
      options: group[0].options,
      success: passed.length > 0,
      latency_ms: mean('latency_ms'),
      throughput_bps: mean('throughput_bps'),
      stability: Math.round((passed.length / group.length) * 100),
      tls: tested('tls'),
      http: tested('http'),
      quic: tested('quic'),
      error: passed.length
        ? undefined
        : group.find((result) => result.error)?.error,
    };
  });
}
