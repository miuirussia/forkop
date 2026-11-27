import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../api', () => ({ desyncApi: { capabilities: vi.fn() } }));
import { desyncApi } from '../api';
import { addDesyncOptions } from '../form';

const data: Record<string, string> = {};
const writes = vi.fn((_: string, _id: string, key: string, value: string) => {
  data[key] = value;
});
const removes = vi.fn((_: string, _id: string, key: string) => {
  delete data[key];
});
let option: CBIOption;
beforeEach(() => {
  Object.keys(data).forEach((key) => delete data[key]);
  writes.mockClear();
  removes.mockClear();
  vi.mocked(desyncApi.capabilities)
    .mockReset()
    .mockResolvedValue({ supported: true });
  vi.stubGlobal('uci', {
    get: (_: string, _id: string, key: string) => data[key],
    set: writes,
    unset: removes,
  });
  option = { renderWidget: vi.fn(), depends: vi.fn() } as unknown as CBIOption;
  addDesyncOptions({
    taboption: (_: string, _kind: unknown, name: string) => {
      expect(name).toBe('desync_options');
      return option;
    },
  } as unknown as CBISection);
});
describe('section desync form storage', () => {
  it('loads legacy strategy and saves canonical JSON without writing the active runtime', async () => {
    data.desync_strategy = 'mode=fake_split ttl=2';
    data.desync_options =
      '{"auto_tune":false,"seqovl":0,"tlsrec_first":false,"fake_sni_pool":["a.example"]}';
    const value = (await option.load('s1')) as string;
    expect(option.validate('s1', value)).toBe(true);
    expect(writes).not.toHaveBeenCalled();
    option.write('s1', value);
    expect(JSON.parse(data.desync_options)).toEqual({
      mode: 'fake_split',
      ttl: 2,
      auto_tune: false,
      seqovl: 0,
      tlsrec_first: false,
      fake_sni_pool: ['a.example'],
    });
    expect(removes).toHaveBeenCalledExactlyOnceWith(
      'forkop',
      's1',
      'desync_strategy',
    );
    expect(writes).toHaveBeenCalledTimes(1);
  });
  it('preserves JSON when the action hides its field', async () => {
    data.desync_options = '{"mode":"split"}';
    await option.load('s1');
    option.remove('s1');
    expect(data.desync_options).toBe('{"mode":"split"}');
    expect(writes).not.toHaveBeenCalled();
    expect(removes).not.toHaveBeenCalled();
    expect(option.depends).toHaveBeenCalledWith('action', 'desync');
    expect(option.retain).toBe(true);
  });
  it('saves separate QUIC false/zero overrides and raw fake socket choice through ordinary UCI', async () => {
    data.desync_strategy = 'udp_mode=auto quic_desync=true quic_repeats=4';
    data.desync_options =
      '{"quic_desync":false,"quic_repeats":0,"udp_keep_socket":false}';
    const value = (await option.load('s1')) as string;
    expect(option.validate('s1', value)).toBe(true);
    option.write('s1', value);
    expect(JSON.parse(data.desync_options)).toEqual({
      udp_mode: 'auto',
      quic_desync: false,
      quic_repeats: 0,
      udp_keep_socket: false,
    });
    expect(data.desync_strategy).toBeUndefined();
  });
  it('blocks unsupported installed cores and keeps invalid saved content available to repair', async () => {
    data.desync_options = '{"unknown":true}';
    vi.mocked(desyncApi.capabilities).mockResolvedValue({
      supported: false,
      reason: 'upgrade to r18',
    });
    const value = (await option.load('s1')) as string;
    expect(value).toContain('unknown');
    expect(option.validate('s1', value)).toBe('upgrade to r18');
    expect(() => option.write('s1', value)).toThrow('upgrade to r18');
    expect(writes).not.toHaveBeenCalled();
  });
  it('deduplicates support checks across section rows', async () => {
    await Promise.all([option.load('s1'), option.load('s2')]);
    expect(desyncApi.capabilities).toHaveBeenCalledTimes(1);
  });
});
