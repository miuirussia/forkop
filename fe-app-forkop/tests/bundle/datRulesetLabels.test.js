import { beforeEach, describe, expect, it } from 'vitest';
import { createHarness } from '../lib/luciForm.js';

const reference = 'dat:geodata_8a6426:livejournal';
let harness;

beforeEach(() => {
  harness = createHarness();
  harness.uci.add('forkop', 'geodata', 'geodata_8a6426');
  harness.uci.set('forkop', 'geodata_8a6426', 'label', 'My Geosite');
  harness.uci.add('forkop', 'section', 'sec');
});

function ruleSetOption(name) {
  const map = new harness.form.Map('forkop');
  const grid = map.section(harness.form.GridSection, 'section');
  harness.bundle.createSectionContent(grid);
  return grid.children.find((option) => option.option === name);
}

describe('DAT rule set labels', () => {
  it.each(['rule_set', '_dns_rule_set'])(
    'shows the tag and source in %s while saving the original reference',
    (name) => {
      const option = ruleSetOption(name);
      const label = option.renderListItemLabel('sec', reference);
      expect(label.textContent).toBe('livejournal (My Geosite)');
      expect(label.getAttribute('title')).toBe(reference);
      option.write('sec', [reference]);
      expect(harness.uci.get('forkop', 'sec', 'rule_set')).toEqual([reference]);
    },
  );

  it('keeps the tag readable if its source is missing and preserves tag filters', () => {
    const option = ruleSetOption('rule_set');
    const label = option.renderListItemLabel('sec', 'dat:missing:google@!cn');
    expect(label.textContent).toBe('google@!cn');
    expect(option.renderListItemLabel('sec', '/etc/custom.srs')).toBe(
      '/etc/custom.srs',
    );
    expect(option.renderListItemLabel('sec', '/etc/custom.srs', 'Custom')).toBe(
      'Custom',
    );
  });

  it('uses the same readable label in the settings dialog', async () => {
    const dialog = await harness.openDialog(
      ruleSetOption('rule_set'),
      'sec',
      reference,
    );
    expect(dialog.title).toBe('Rule set: livejournal (My Geosite)');
  });
});

describe('SagerNet rule set labels', () => {
  it.each(['geosite', 'geoip'])(
    'distinguishes %s in the list and settings title when tags coincide',
    async (kind) => {
      const url = `https://raw.githubusercontent.com/SagerNet/sing-${kind}/rule-set/${kind}-cn.srs`;
      const option = ruleSetOption('rule_set');
      const label = option.renderListItemLabel('sec', url);
      expect(label.textContent).toBe(`cn (SagerNet, ${kind})`);
      expect(label.getAttribute('title')).toBe(url);

      const dialog = await harness.openDialog(option, 'sec', url);
      expect(dialog.title).toBe(`Rule set: cn (SagerNet, ${kind})`);
    },
  );
});
