import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../services/singGeo.service', () => ({
  loadSingGeositeFiles: vi.fn(),
  loadSingGeoipFiles: vi.fn(),
  SING_GEOIP_URL:
    'https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set/',
  SING_GEOSITE_URL:
    'https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/',
}));

import {
  loadSingGeositeFiles,
  loadSingGeoipFiles,
} from '../../../services/singGeo.service';
import {
  loadGeoRulesetValues,
  validateCustomRulesetReference,
  writeCustomRulesetReferences,
  writeDnsRulesetReferences,
} from '../ruleSets';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadSingGeoipFiles).mockResolvedValue([]);
});

afterEach(() => vi.unstubAllGlobals());

describe('sing-geosite rule choices', () => {
  it('offers raw SRS URLs with readable labels and saves them for routing and DNS', async () => {
    vi.mocked(loadSingGeositeFiles).mockResolvedValue([
      'geosite-youtube.srs',
      'geosite-google@!cn.srs',
    ]);
    const option = { keylist: ['old'], vallist: ['old'], value: vi.fn() };
    await loadGeoRulesetValues(option as unknown as CBIOption);
    const url =
      'https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-youtube.srs';
    expect(option.value).toHaveBeenCalledWith(url, 'geosite: youtube');
    expect(option.value).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-google@!cn.srs',
      'geosite: google@!cn',
    );
    expect(option.keylist).toBeUndefined();
    expect(validateCustomRulesetReference(url)).toBe(true);
    const set = vi.fn();
    vi.stubGlobal('uci', { get: () => undefined, set, unset: vi.fn() });
    writeCustomRulesetReferences('route', [url, '/etc/forkop/custom.srs']);
    writeDnsRulesetReferences('dns', [url]);
    expect(set).toHaveBeenCalledWith('forkop', 'route', 'rule_set', [
      url,
      '/etc/forkop/custom.srs',
    ]);
    expect(set).toHaveBeenCalledWith('forkop', 'dns', 'rule_set', [url]);
  });

  it('leaves manual input available and explains a missing catalog', async () => {
    vi.mocked(loadSingGeositeFiles).mockResolvedValue([]);
    const option = { value: vi.fn(), description: '' };
    await loadGeoRulesetValues(option as unknown as CBIOption);
    expect(option.value).not.toHaveBeenCalled();
    expect(option.description).toContain(
      'Could not load the rule set catalogs',
    );
    expect(validateCustomRulesetReference('/etc/forkop/custom.srs')).toBe(true);
  });

  it('offers GeoIP for routing with the subnet setting explained, but only geosite for DNS', async () => {
    vi.mocked(loadSingGeositeFiles).mockResolvedValue(['geosite-youtube.srs']);
    vi.mocked(loadSingGeoipFiles).mockResolvedValue(['geoip-ru.srs']);
    const route = { value: vi.fn(), description: '' };
    await loadGeoRulesetValues(route as unknown as CBIOption);
    expect(route.value).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set/geoip-ru.srs',
      'geoip: ru',
    );
    expect(route.description).toContain('Include IP addresses and subnets');
    vi.mocked(loadSingGeoipFiles).mockClear();
    const dns = { value: vi.fn(), description: '' };
    await loadGeoRulesetValues(dns as unknown as CBIOption, false);
    expect(loadSingGeoipFiles).not.toHaveBeenCalled();
    expect(dns.value).toHaveBeenCalledTimes(1);
    expect(dns.description).not.toContain('sing-geoip');
  });

  it('still offers the available catalog if the other source fails', async () => {
    vi.mocked(loadSingGeositeFiles).mockResolvedValue([]);
    vi.mocked(loadSingGeoipFiles).mockResolvedValue(['geoip-ru.srs']);
    const option = { value: vi.fn(), description: '' };
    await loadGeoRulesetValues(option as unknown as CBIOption);
    expect(option.value).toHaveBeenCalledTimes(1);
    expect(option.description).not.toContain('Could not load');
  });
});
