import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeShellCommand } from '../../../helpers/executeShellCommand';
import {
  getGeodataTags,
  getGeodataState,
  parseDatReference,
  updateGeodata,
  validateGeodataInterval,
} from '../geodata.service';

vi.mock('../../../helpers/executeShellCommand', () => ({
  executeShellCommand: vi.fn(),
}));
afterEach(() => vi.clearAllMocks());

describe('DAT references and schedules', () => {
  it('shares concurrent source status requests between table rows', async () => {
    vi.mocked(executeShellCommand).mockResolvedValue({
      stdout: '{"sources":[],"job":null}',
      stderr: '',
      code: 0,
    });
    await Promise.all([
      getGeodataState(),
      getGeodataState(),
      getGeodataState(),
    ]);
    expect(executeShellCommand).toHaveBeenCalledTimes(1);
  });
  it('accepts source references and attribute filters without allowing paths', () => {
    expect(parseDatReference('dat:sites:google@!cn')).toEqual({
      source: 'sites',
      tag: 'google@!cn',
    });
    for (const ref of [
      'dat:sites:../escape',
      'dat:../sites:google',
      'dat:sites:google@',
      '/etc/geosite.dat',
    ])
      expect(parseDatReference(ref)).toBeNull();
  });
  it('uses bounded update intervals', () => {
    for (const value of ['5m', '12h', '1d', '365d'])
      expect(validateGeodataInterval(value)).toBe(true);
    for (const value of ['1m', '0d', '366d', '1s', 'forever'])
      expect(validateGeodataInterval(value)).not.toBe(true);
  });
  it('requests one page and passes the search as a separate argument', async () => {
    vi.mocked(executeShellCommand).mockResolvedValue({
      stdout: '{"tags":[],"total":0,"offset":200}',
      stderr: '',
      code: 0,
    });
    await getGeodataTags('sites', 'google', 200);
    expect(executeShellCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ['geodata_tags', 'sites', 'google', '200'],
      }),
    );
  });
  it('reports a refused background update', async () => {
    vi.mocked(executeShellCommand).mockResolvedValue({
      stdout: '{"success":false,"message":"busy"}',
      stderr: '',
      code: 1,
    });
    await expect(updateGeodata('sites')).rejects.toThrow('busy');
  });
});
