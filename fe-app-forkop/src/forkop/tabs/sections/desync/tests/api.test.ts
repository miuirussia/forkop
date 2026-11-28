import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../../../helpers/callUbus', () => ({ callUbus: vi.fn() }));
import { callUbus } from '../../../../../helpers/callUbus';
import { desyncApi } from '../api';
import { validateDesync } from '../model';

import {
  desyncCapabilities as CORE,
  desyncContract as CONTRACT,
} from '../../../../../../tests/lib/desync.js';

beforeEach(() => vi.mocked(callUbus).mockReset());
describe('authenticated desync API', () => {
  it('normalizes the actual parameter support matrix without treating Linux pre-SYN requirements as refusals', async () => {
    vi.mocked(callUbus).mockResolvedValue({
      success: true,
      data: {
        success: true,
        available: true,
        capabilities: {
          ...CORE,
          supported: true,
          platform: 'linux',
          parameters: {
            ...CORE.parameters,
            wscale: {
              supported: true,
              requirements: 'pre-SYN TCP_WINDOW_CLAMP; CAP_NET_ADMIN',
            },
            syndata: { supported: true, requirements: 'Linux CAP_NET_RAW' },
            udp_keep_socket: {
              supported: true,
              requirements:
                'false uses ephemeral raw UDP injector, Linux CAP_NET_RAW',
            },
          },
          mode_support: {
            ...CORE.mode_support,
            split: { supported: true, requirements: '' },
            fake: { supported: true, requirements: 'Linux CAP_NET_RAW' },
          },
        },
      },
    });
    const support = await desyncApi.capabilities();
    expect(support.requirements?.wscale).toContain('pre-SYN');
    expect(support.unsupported).toEqual({});
    expect(
      validateDesync(
        { wscale: 0, syndata: 'YWJjZA==', udp_keep_socket: false },
        support,
      ),
    ).toBe(true);
  });
  it('uses the runtime matrix to explain unsupported modes and parameters', async () => {
    vi.mocked(callUbus).mockResolvedValue({
      success: true,
      data: {
        success: true,
        available: true,
        capabilities: {
          ...CORE,
          supported: true,
          platform: 'darwin',
          parameters: {
            ...CORE.parameters,
            preset: { supported: true, requirements: '' },
            wscale: {
              supported: false,
              requirements: 'Linux pre-SYN required',
            },
          },
          mode_support: {
            ...CORE.mode_support,
            fake: {
              supported: false,
              requirements: 'Linux CAP_NET_RAW required',
            },
          },
        },
      },
    });
    const support = await desyncApi.capabilities();
    expect(validateDesync({ wscale: 0 }, support)).toContain('Linux pre-SYN');
    expect(validateDesync({ preset: 'fake' }, support)).toContain(
      'Linux CAP_NET_RAW',
    );
  });
  it('normalizes the backend capability envelope', async () => {
    vi.mocked(callUbus).mockResolvedValue({
      success: true,
      data: {
        success: true,
        available: true,
        capabilities: CORE,
      },
    });
    expect(await desyncApi.capabilities()).toMatchObject({
      supported: true,
      modes: CORE.modes,
      protocols: CORE.protocols,
    });
    expect(callUbus).toHaveBeenCalledWith(
      expect.objectContaining({
        object: 'forkop',
        method: 'desync_capabilities',
        params: { payload: '{}' },
      }),
    );
  });
  it.each([
    undefined,
    null,
    {},
    { supported: true },
    { ...CORE, parameters: ['mode'] },
    { ...CORE, mode_support: undefined },
    { ...CORE, capability: 'unrelated' },
    { ...CORE, version: 0 },
  ])(
    'refuses missing or obsolete capability contracts: %j',
    async (capabilities) => {
      vi.mocked(callUbus).mockResolvedValue({
        success: true,
        data: {
          success: true,
          available: true,
          capabilities,
          modes: ['split'],
          presets: ['split'],
        },
      });
      expect((await desyncApi.capabilities()).supported).toBe(false);
    },
  );
  async function supportFor(capabilities: unknown) {
    vi.mocked(callUbus).mockResolvedValue({
      success: true,
      data: { success: true, available: true, capabilities },
    });
    return desyncApi.capabilities();
  }
  it.each<Record<string, unknown>>(CONTRACT.capability_overrides_rejected)(
    'refuses incomplete r20 contracts %j',
    async (overrides) => {
      expect((await supportFor({ ...CORE, ...overrides })).supported).toBe(
        false,
      );
    },
  );
  it.each(['parameters', 'mode_support'])(
    'requires every r20 %s entry with its actual schema',
    async (table) => {
      for (const key of Object.keys(CORE[table])) {
        const entries = { ...CORE[table] };
        delete entries[key];
        expect(
          (await supportFor({ ...CORE, [table]: entries })).supported,
          key,
        ).toBe(false);
      }
      for (const value of CONTRACT.capability_entries_rejected) {
        expect(
          (
            await supportFor({
              ...CORE,
              [table]: { ...CORE[table], [Object.keys(CORE[table])[0]]: value },
            })
          ).supported,
        ).toBe(false);
      }
    },
  );
  it('supports a complete core without compiled QUIC probes', async () => {
    expect(
      (await supportFor({ ...CORE, protocols: ['tls', 'http'] })).supported,
    ).toBe(true);
  });
  it('unwraps actual active diagnostics instead of treating the RPC envelope as stats', async () => {
    const snapshot = {
      capability: 'forkop-desync-v1',
      outbounds: {
        demo: { current: 'split', reason: 'connected', entries: {}, active: 0 },
      },
    };
    vi.mocked(callUbus).mockResolvedValue({
      success: true,
      data: { success: true, diagnostics: snapshot },
    });
    expect(await desyncApi.diagnostics('s1')).toEqual(snapshot);
  });
  it('sends bounded isolated probes without an apply or config mutation', async () => {
    const request = {
      section: 's1',
      target: 'example.org:443',
      protocol: 'tls',
      candidates: [{ preset: 'split', auto_tune: false }],
      timeout: 5,
      repetitions: 2,
      max_duration: 60,
      max_bytes: 65536,
    };
    vi.mocked(callUbus).mockResolvedValue({
      success: true,
      data: { success: true, id: '1-2-3', state: 'running', results: [] },
    });
    expect(await desyncApi.start(request)).toMatchObject({ id: '1-2-3' });
    expect(callUbus).toHaveBeenCalledExactlyOnceWith({
      object: 'forkop',
      method: 'desync_tune_start',
      params: { payload: JSON.stringify(request) },
      timeoutMs: 15000,
      retryUnavailable: false,
    });
  });
  it('does not reissue a mutation after a lost reply', async () => {
    vi.mocked(callUbus).mockResolvedValue({
      success: false,
      unavailable: false,
      message: 'timed out',
    });
    await expect(desyncApi.cancel('1-2-3')).rejects.toThrow('timed out');
    expect(callUbus).toHaveBeenCalledTimes(1);
  });
  it('surfaces backend unsupported-setting errors', async () => {
    vi.mocked(callUbus).mockResolvedValue({
      success: true,
      data: { success: false, message: 'wscale requires pre-SYN hook' },
    });
    await expect(desyncApi.clear('s1')).rejects.toThrow('pre-SYN hook');
  });
});
