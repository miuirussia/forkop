import { describe, expect, it } from 'vitest';
import {
  customDesync,
  exportDesync,
  importDesync,
  loadDesync,
  validateDesync,
} from '../model';

describe('canonical desync strategies', () => {
  it('folds embedded strings, retaining explicit false/zero and advanced fields', () => {
    const value = loadDesync(
      JSON.stringify({
        preset: 'auto',
        strategy: 'mode=fake_split ttl=4',
        ttl: 8,
        auto_tune: false,
        seqovl: 0,
        tlsrec_first: false,
        fake_sni_pool: ['a.example'],
      }),
    );
    expect(value).toEqual({
      preset: 'auto',
      mode: 'fake_split',
      ttl: 8,
      auto_tune: false,
      seqovl: 0,
      tlsrec_first: false,
      fake_sni_pool: ['a.example'],
    });
    expect(value).not.toHaveProperty('strategy');
    expect(validateDesync(value)).toBe(true);
  });
  it('round trips every value including Adaptive and quoted strings', () => {
    const value = {
      preset: 'auto',
      mode: 'fake_split',
      auto_tune: true,
      seqovl: 0,
      tlsrec_first: false,
      fake_sni_pool: ['a.example', 'b.example'],
      adaptive: { max_entries: 1024, network_id: 'home wifi', timeout: '5s' },
      fake_payload: 'YWJjZA==',
    };
    expect(importDesync(exportDesync(value))).toEqual(value);
    expect(importDesync(JSON.stringify(value))).toEqual(value);
  });
  it.each([
    '0',
    '0s',
    '0ms',
    '0us',
    '0µs',
    '0ns',
    '0.1ns',
    '0.0000001ms',
    '0.6ns0.6ns',
    '0h0m0s0ms0us0µs0ns',
    '100µs',
    '0.25us',
    '999ms1000µs',
    '1s',
  ])(
    'accepts and preserves core-supported delay %s through form interchange',
    (delay) => {
      const value = {
        preset: 'custom',
        mode: 'split',
        auto_tune: false,
        delay,
      };
      expect(validateDesync(value)).toBe(true);
      expect(importDesync(exportDesync(value))).toEqual(value);
      expect(loadDesync(JSON.stringify(value))).toEqual(value);
    },
  );
  it('accepts existing comma-separated pools and semantic markers', () => {
    const value = importDesync(
      'mode=fake_split fake_sni_pool="a.example,b.example" split_pos=sniext+1,midsld-2,endhost-1,extlen,host+1,1',
    );
    expect(value.fake_sni_pool).toEqual(['a.example', 'b.example']);
    expect(validateDesync(value)).toBe(true);
  });
  it('converts a result to a manual custom strategy without modifying its source', () => {
    const value = {
      preset: 'auto',
      auto_tune: true,
      adaptive: { max_attempts: 2 },
      mode: 'split',
      seqovl: 0,
    };
    expect(customDesync(value)).toEqual({
      preset: 'custom',
      auto_tune: false,
      mode: 'split',
      seqovl: 0,
    });
    expect(value.adaptive).toEqual({ max_attempts: 2 });
  });
  it.each(['split', 'disorder', 'tlsrec', 'fake', 'fake_split', 'oob'])(
    'preserves the behavior of preset-only %s during custom conversion',
    (preset) => {
      expect(customDesync({ preset })).toEqual({
        preset: 'custom',
        mode: preset,
        auto_tune: false,
      });
    },
  );
  it.each([1, 2, 3, 4])(
    'preserves GT%s UDP behavior and explicit QUIC overrides during custom conversion',
    (repeats) => {
      expect(
        customDesync({
          preset: `GT${repeats}`,
          quic_desync: false,
          quic_repeats: 0,
        }),
      ).toEqual({
        preset: 'custom',
        mode: 'none',
        udp_mode: 'auto',
        udp_repeats: repeats,
        udp_out_range: `1:${repeats}`,
        quic_desync: false,
        quic_repeats: 0,
        auto_tune: false,
      });
    },
  );
  it('keeps explicit values ahead of defaults when expanding a game preset', () => {
    expect(
      customDesync({
        preset: 'GT4',
        mode: 'split',
        udp_mode: 'quic',
        udp_repeats: 1,
        udp_out_range: '2:3',
      }),
    ).toEqual({
      preset: 'custom',
      mode: 'split',
      udp_mode: 'quic',
      udp_repeats: 1,
      udp_out_range: '2:3',
      auto_tune: false,
    });
  });
  it.each([0, 1, 16])(
    'round trips QUIC repeats %s and optional booleans through JSON and strategy strings',
    (quic_repeats) => {
      const value = {
        udp_mode: 'auto',
        quic_desync: quic_repeats > 0,
        quic_repeats,
        udp_keep_socket: false,
      };
      expect(validateDesync(value)).toBe(true);
      expect(importDesync(exportDesync(value))).toEqual(value);
      expect(importDesync(JSON.stringify(value))).toEqual(value);
    },
  );
  it.each([
    'mode=split mode=fake',
    'unknown=true',
    'mode="split',
    'adaptive={"timeout":"5s"',
    'strategy="mode=fake"',
    'mode="split"oops',
  ])('rejects ambiguous strategy text: %s', (value) => {
    expect(() => importDesync(value)).toThrow();
  });
  it.each(['[]', 'null', 'true', '{"strategy":false}'])(
    'rejects nonobject imports: %s',
    (value) => {
      expect(() => importDesync(value)).toThrow();
    },
  );
  it.each([
    { unknown: true },
    { mode: 'split', repeats: 2 },
    { mode: 'none', delay: '1ms' },
    { mode: 'magic' },
    { preset: 'GT9' },
    { split_pos: '0' },
    { split_pos: 'sni+' },
    { repeats: 0 },
    { repeats: 17 },
    { ttl: 256 },
    { auto_tune: 'false' },
    { udp_mode: 'quic', udp_out_range: '3:1' },
    { udp_mode: 'auto', udp_out_range: '1:1025' },
    { delay: '2s' },
    { fake_payload: 'bad!' },
    { fake_sni_pool: ['bad host'] },
    { auto_tune: false, adaptive: {} },
    { adaptive: { unknown: 1 } },
    { auto_tune: true, adaptive: { max_attempts: 9 } },
    { preset: 'auto', adaptive: { timeout: '100ms' } },
    { mode: 'split', fake_sni: 'fake.example' },
    { mode: 'none', tlsrec_first: true },
    { udp_ttl: 3 },
    { ipfrag: 9 },
    { seqovl: 4097 },

    { udp_mode: 'stun', udplen: 3 },
  ])('rejects unsupported, mistyped and incompatible options %j', (value) => {
    expect(validateDesync(value)).not.toBe(true);
  });
  it('allows authenticated QUIC Initial padding without STUN alignment restrictions', () => {
    expect(validateDesync({ udp_mode: 'quic', udplen: 33 })).toBe(true);
  });
  it.each([0, 1, 16])(
    'round trips independent QUIC parameters, preserving %s',
    (repeats) => {
      const value = {
        udp_mode: 'auto',
        quic_desync: repeats === 0 ? false : true,
        quic_repeats: repeats,
        udp_keep_socket: false,
      };
      expect(
        validateDesync(value, { supported: true, platform: 'linux' }),
      ).toBe(true);
      expect(importDesync(exportDesync(value))).toEqual(value);
      expect(importDesync(JSON.stringify(value))).toEqual(value);
      expect(loadDesync(JSON.stringify(value))).toEqual(value);
    },
  );
  it('keeps QUIC defaults absent until explicitly set, and supports GT presets', () => {
    expect(importDesync('udp_mode=auto')).toEqual({ udp_mode: 'auto' });
    expect(
      validateDesync({ preset: 'GT1', quic_desync: false, quic_repeats: 0 }),
    ).toBe(true);
    expect(validateDesync({ preset: 'GT4', quic_repeats: 16 })).toBe(true);
    expect(
      validateDesync({ udp_mode: 'auto', quic_desync: false, udplen: 8 }),
    ).toBe(true);
  });
  it.each([
    { udp_mode: 'auto', quic_desync: 'false' },
    { udp_mode: 'auto', quic_desync: 0 },
    { udp_mode: 'auto', quic_desync: null },
    { udp_mode: 'quic', quic_repeats: '0' },
    { udp_mode: 'quic', quic_repeats: false },
    { udp_mode: 'quic', quic_repeats: null },
    { udp_mode: 'quic', quic_repeats: -1 },
    { udp_mode: 'quic', quic_repeats: 17 },
    { udp_mode: 'quic', quic_repeats: 1.5 },
    { udp_mode: 'quic', quic_repeats: -1 },
    { udp_mode: 'quic', quic_repeats: '0' },
    { udp_mode: 'quic', quic_repeats: null },
    { udp_mode: 'quic', quic_desync: 'false' },
    { udp_mode: 'quic', quic_desync: null },
    { udp_mode: 'quic', quic_desync: 0 },
    { quic_desync: true },
    { udp_mode: 'none', quic_desync: false },
    { udp_mode: 'stun', quic_desync: false },
    { udp_mode: 'stun', quic_repeats: 1 },
    { udp_mode: 'stun', quic_repeats: 0 },
    { udp_mode: 'quic', quic_desync: false, udplen: 32 },
    { mode: 'none', split_pos: 'sni' },
    { mode: 'fake', split_pos: 'sni' },
    { udp_mode: 'auto', quic_desync: false, quic_repeats: 1 },
  ])('rejects mistyped or incompatible QUIC configuration %j', (value) => {
    expect(validateDesync(value)).not.toBe(true);
  });
  it.each([0, 2, 7, 14])(
    'allows implemented Linux pre-SYN scale %s and SYN data',
    (wscale) => {
      expect(
        validateDesync(
          { wscale, syndata: 'YWJjZA==' },
          { supported: true, platform: 'linux' },
        ),
      ).toBe(true);
    },
  );
  it.each(['split', 'multi_split', 'tlsrec', 'none'])(
    'allows a Linux SYN-data TTL independently of TCP mode %s',
    (mode) => {
      const value = {
        preset: 'custom',
        mode,
        syndata: 'YWJj',
        ttl: 8,
        auto_tune: false,
      };
      expect(
        validateDesync(value, { supported: true, platform: 'linux' }),
      ).toBe(true);
      expect(importDesync(exportDesync(value))).toEqual(value);
    },
  );
  it.each([undefined, ''])(
    'keeps TTL fake-only without a SYN payload (%s)',
    (syndata) => {
      const value = {
        mode: 'split',
        ttl: 8,
        ...(syndata === undefined ? {} : { syndata }),
      };
      expect(validateDesync(value)).toContain('Fake parameters');
    },
  );
  it.each([
    { fake_sni: 'example.org' },
    { fake_host: 'example.org' },
    { fake_payload: 'YWJj' },
    { fake_sni_pool: ['example.org'] },
    { fooling: 'badseq' },
    { autottl: true },
  ])('keeps other fake-only settings rejected with SYN data: %j', (fake) => {
    expect(
      validateDesync({ mode: 'split', syndata: 'YWJj', ttl: 8, ...fake }),
    ).toContain('Fake parameters');
  });
  it('uses actual platform and value-specific capability reasons without forbidding socket retention', () => {
    expect(
      validateDesync({ udp_mode: 'auto', quic_desync: false, udplen: 32 }),
    ).toBe(true);
    expect(
      validateDesync({
        mode: 'fake',
        fooling: '',
        split_pos: 'sni',
        seqovl: 3,
      }),
    ).toBe(true);
    expect(validateDesync({ udp_mode: 'stun', udp_keep_socket: false })).toBe(
      true,
    );
    expect(
      validateDesync(
        { udp_mode: 'stun', udp_keep_socket: false },
        { supported: true, platform: 'darwin' },
      ),
    ).toContain('CAP_NET_RAW');
    expect(
      validateDesync({ wscale: 0 }, { supported: true, platform: 'darwin' }),
    ).toContain('Linux');
  });
  it('uses installed core support and explicit unsupported reasons', () => {
    expect(
      validateDesync(
        { preset: 'split' },
        { supported: false, reason: 'requires r20' },
      ),
    ).toBe('requires r20');
    expect(
      validateDesync(
        { wscale: 2 },
        { supported: true, unsupported: { wscale: 'requires pre-SYN hook' } },
      ),
    ).toContain('requires pre-SYN hook');
    expect(
      validateDesync({ mode: 'fake' }, { supported: true, modes: ['split'] }),
    ).not.toBe(true);
    expect(
      validateDesync({ ttl: 2 }, { supported: true, parameters: ['mode'] }),
    ).not.toBe(true);
  });
});
