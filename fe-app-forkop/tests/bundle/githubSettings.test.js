import { expect, it } from 'vitest';
import { createHarness } from '../lib/luciForm.js';

it('keeps the GitHub token in its own settings group and allows replacing and removing it', async () => {
  const harness = createHarness();
  harness.uci.add('forkop', 'settings', 'settings');
  harness.uci.set('forkop', 'settings', 'github_token', 'github_pat_old');
  const map = new harness.form.Map('forkop');
  const section = map.section(harness.form.NamedSection, 'settings');
  harness.bundle.createSettingsContent(section);
  section.cfgsections = () => ['settings'];
  await section.load();
  const token = section.children.find((o) => o.option === 'github_token');
  expect(token.tab).toBe('settings-github');
  expect(token.password).toBe(true);
  expect(token.validate('settings', '')).toBe(true);
  expect(token.validate('settings', ' github_pat_new ')).toBe(true);
  expect(token.validate('settings', 'bad\r\nX-Header: value')).not.toBe(true);
  await section.parse();
  expect(harness.uci.get('forkop', 'settings', 'github_token')).toBe(
    'github_pat_old',
  );
  token.write('settings', ' github_pat_new ');
  expect(harness.uci.get('forkop', 'settings', 'github_token')).toBe(
    'github_pat_new',
  );
  token.remove('settings');
  expect(harness.uci.get('forkop', 'settings', 'github_token')).toBeNull();
});
