import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SING_GEOIP_URL,
  SING_GEOSITE_URL,
} from '../../../services/singGeo.service';
import {
  renderRulesetItemLabel,
  validateCustomRulesetReference,
  writeCustomRulesetReferences,
  writeDnsRulesetReferences,
} from '../ruleSets';

beforeEach(() => {
  vi.stubGlobal('E', (_tag: string, attrs: object, children: string[]) => ({
    ...attrs,
    textContent: children.join(''),
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('SagerNet rule set labels', () => {
  it.each([
    [SING_GEOSITE_URL + 'geosite-reddit.srs', 'reddit (SagerNet, geosite)'],
    [
      SING_GEOSITE_URL + 'geosite-google@!cn.srs',
      'google@!cn (SagerNet, geosite)',
    ],
    [SING_GEOIP_URL + 'geoip-ru.srs', 'ru (SagerNet, geoip)'],
    [SING_GEOSITE_URL + 'geosite-cn.srs', 'cn (SagerNet, geosite)'],
    [SING_GEOIP_URL + 'geoip-cn.srs', 'cn (SagerNet, geoip)'],
  ])('labels %s without changing its saved reference', (url, label) => {
    expect(renderRulesetItemLabel('route', url, 'old label')).toEqual({
      title: url,
      textContent: label,
    });
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

  it('keeps custom URLs, paths and labels intact', () => {
    for (const value of [
      '/etc/forkop/custom.srs',
      'https://example.com/geosite-reddit.srs',
    ]) {
      expect(renderRulesetItemLabel('route', value)).toBe(value);
      expect(renderRulesetItemLabel('route', value, 'Custom')).toBe('Custom');
      expect(validateCustomRulesetReference(value)).toBe(true);
    }
  });
});
