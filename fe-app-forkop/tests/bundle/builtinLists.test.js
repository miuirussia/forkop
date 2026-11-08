import { beforeEach, describe, expect, it } from 'vitest';

import { createHarness } from '../lib/luciForm.js';

let harness;

beforeEach(() => {
  harness = createHarness();
});

async function builtinListsOption() {
  harness.uci.add('forkop', 'section', 'section_probe');
  Object.assign(harness.store.get('section_probe'), {
    action: 'connection',
    enabled: '1',
    label: 'Probe',
    community_lists: ['ru_only'],
  });
  const map = new harness.form.Map('forkop');
  const grid = map.section(harness.form.GridSection, 'section');
  harness.bundle.createSectionContent(grid);
  grid.cfgsections = () => ['section_probe'];
  await grid.load();
  return grid.children.find((child) => child.option === 'community_lists');
}

describe('the built-in lists field', () => {
  it('offers the lists by name in their order, the blocked ones first', async () => {
    const option = await builtinListsOption();

    expect(option.keylist.slice(0, 6)).toEqual([
      'ru_blocked_all',
      'ru_blocked_rkn',
      'ru_blocked_geo',
      'ru_only',
      'ua_blocked',
      'ai',
    ]);
    expect(option.keylist.at(-1)).toBe('ads');
    expect(option.vallist.slice(0, 4)).toEqual([
      'RU Blocked (All)',
      'RU Blocked (RKN)',
      'RU Blocked (Geo)',
      'RU Only',
    ]);
  });
});

describe('sing-geosite and sing-geoip in the rule set fields', () => {
  it('offers SRS URLs for both routing and DNS and keeps custom entries', async () => {
    harness.uci.add('forkop', 'section', 'section_probe');
    Object.assign(harness.store.get('section_probe'), {
      action: 'connection',
      rule_set: ['/etc/forkop/custom.srs'],
      rule_set_with_subnets: ['https://example.com/mixed.srs'],
    });
    const map = new harness.form.Map('forkop');
    const grid = map.section(harness.form.GridSection, 'section');
    harness.bundle.createSectionContent(grid);

    for (const name of ['rule_set', '_dns_rule_set']) {
      const option = grid.children.find((child) => child.option === name);
      expect(await option.load('section_probe')).toEqual([
        '/etc/forkop/custom.srs',
        'https://example.com/mixed.srs',
      ]);
      const geoip = name === 'rule_set';
      expect(option.keylist).toEqual([
        'https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-youtube.srs',
        ...(geoip
          ? [
              'https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set/geoip-ru.srs',
            ]
          : []),
      ]);
      expect(option.vallist).toEqual([
        'geosite: youtube',
        ...(geoip ? ['geoip: ru'] : []),
      ]);
    }
  });
});
