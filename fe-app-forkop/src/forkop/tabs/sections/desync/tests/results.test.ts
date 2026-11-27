import { describe, expect, it } from 'vitest';
import { summarizeDesyncResults } from '../results';

describe('desync probe metrics', () => {
  it('shows measured stability and latency without inventing speed or QUIC results', () => {
    const options = { preset: 'split' };
    const value = summarizeDesyncResults([
      { options, success: true, protocol: 'tls', latency_ms: 20 },
      { options, success: false, protocol: 'tls', error: 'timeout' },
    ]);
    expect(value).toEqual([
      expect.objectContaining({
        options,
        success: true,
        tls: true,
        http: undefined,
        quic: undefined,
        latency_ms: 20,
        stability: 50,
        throughput_bps: undefined,
      }),
    ]);
  });
  it('keeps failed candidates and averages successful download probes', () => {
    const value = summarizeDesyncResults([
      {
        candidate: 0,
        options: { mode: 'split' },
        success: true,
        protocol: 'http',
        tls_version: 772,
        latency_ms: 20,
        throughput_bps: 1000,
      },
      {
        candidate: 0,
        options: { mode: 'split' },
        success: true,
        protocol: 'http',
        tls_version: 772,
        latency_ms: 40,
        throughput_bps: 2000,
      },
      {
        candidate: 1,
        options: { mode: 'fake' },
        success: false,
        protocol: 'quic',
        error: 'handshake failed',
      },
    ]);
    expect(value[0]).toMatchObject({
      tls: true,
      http: true,
      latency_ms: 30,
      throughput_bps: 1500,
      stability: 100,
    });
    expect(value[1]).toMatchObject({
      quic: false,
      success: false,
      stability: 0,
      error: 'handshake failed',
    });
  });
});
