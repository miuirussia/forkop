import { expect, it } from 'vitest';
import { createHarness } from '../lib/luciForm.js';

it('keeps Autodetect settings in their own group and preserves them when disabled', async () => {
  const harness = createHarness();
  harness.uci.add('forkop', 'settings', 'settings');
  harness.uci.add('forkop', 'section', 'vpn');
  harness.uci.set('forkop', 'vpn', 'action', 'connection');
  const values = {
    enable_autodetect: '1',
    autodetect_proxy_section: 'vpn',
    autodetect_timeout: '20',
    autodetect_confirmations: '3',
    autodetect_stall_timeout: '30',
    autodetect_response_limit: '128',
    autodetect_recheck_interval: '60',
    autodetect_history_limit: '50',
  };
  for (const [key, value] of Object.entries(values))
    harness.uci.set('forkop', 'settings', key, value);
  const map = new harness.form.Map('forkop');
  const section = map.section(harness.form.NamedSection, 'settings');
  harness.bundle.createSettingsContent(section);
  section.cfgsections = () => ['settings'];
  await section.load();
  for (const key of Object.keys(values)) {
    expect(section.children.find((o) => o.option === key).tab).toBe(
      'settings-autodetect',
    );
  }
  const timeout = section.children.find(
    (o) => o.option === 'autodetect_timeout',
  );
  expect(timeout.validate('settings', '0')).not.toBe(true);
  expect(timeout.validate('settings', '61')).not.toBe(true);
  expect(timeout.validate('settings', '20')).toBe(true);
  harness.uci.set('forkop', 'settings', 'enable_autodetect', '0');
  await section.load();
  await section.parse();
  for (const [key, value] of Object.entries(values)) {
    if (key !== 'enable_autodetect')
      expect(harness.uci.get('forkop', 'settings', key)).toBe(value);
  }
});
