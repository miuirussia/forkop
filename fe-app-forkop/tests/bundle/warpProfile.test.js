import { beforeEach, describe, expect, it } from 'vitest';

import { coreFeatures } from '../lib/coreFeatures.js';
import { createHarness } from '../lib/luciForm.js';

let harness;

beforeEach(() => {
  harness = createHarness();
  harness.bundle.setCoreFeatures(coreFeatures());
  harness.uci.add('forkop', 'section', 'sec');
  Object.assign(harness.store.get('sec'), {
    action: 'connection',
    enabled: '1',
    label: 'Home',
  });
});

const option = (section, name) =>
  section.children.find((child) => child.option === name);

function openTunnel(tunnelId = '') {
  const map = new harness.form.Map('forkop');
  const sections = map.section(harness.form.GridSection, 'section');
  delete sections.load;
  harness.bundle.createSectionContent(sections);
  return harness.openDialog(option(sections, 'tunnels'), 'sec', tunnelId, {
    adding: !tunnelId,
  });
}

async function pressGenerate() {
  const dialog = await openTunnel();
  await option(dialog.map.children[0], '_generate_warp_profile').onclick();
  const value = (name) =>
    dialog.map.data.get(dialog.map.config, 'settings', name);
  return {
    id: value('warp_profile_id'),
    token: value('warp_auth_token'),
    key: value('warp_private_key'),
  };
}

function seedWarpTunnel(extra = {}) {
  harness.uci.add('forkop', 'tunnel', 'tun');
  const stored = harness.store.get('tun');
  Object.assign(stored, {
    section: 'sec',
    kind: 'warp',
    name: 'WARP',
    warp_profile_id: 'profile-id',
    warp_profile_auth_token: 'auth-token',
    warp_profile_private_key: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
    ...extra,
  });
  return stored;
}

it.each(['system', 'kernel'])(
  'saves and clears the WARP %s mode',
  async (mode) => {
    const stored = seedWarpTunnel();
    const dialog = await openTunnel('tun');
    const field = option(dialog.map.children[0], 'wireguard_mode');
    expect(field.isActive('settings')).toBe(true);
    expect(field.keylist).toEqual(['userspace', 'system', 'kernel']);
    expect(field.formvalue('settings')).toBe('userspace');
    field.formvalue = () => mode;
    expect(await dialog.save()).toEqual({ saved: true });
    expect(stored.wireguard_mode).toBe(mode);

    const reopened = await openTunnel('tun');
    const reopenedMode = option(reopened.map.children[0], 'wireguard_mode');
    expect(reopenedMode.formvalue('settings')).toBe(mode);
    reopenedMode.formvalue = () => 'userspace';
    expect(await reopened.save()).toEqual({ saved: true });
    expect(stored).not.toHaveProperty('wireguard_mode');
  },
);

it('reads the former WARP Kernel flag and saves it as a mode', async () => {
  const stored = seedWarpTunnel({ warp_kernel: '1' });
  const dialog = await openTunnel('tun');
  const field = option(dialog.map.children[0], 'wireguard_mode');
  expect(field.formvalue('settings')).toBe('kernel');
  expect(await dialog.save()).toEqual({ saved: true });
  expect(stored.wireguard_mode).toBe('kernel');
  expect(stored).not.toHaveProperty('warp_kernel');
});

it('keeps the default and explicit mode when changing tunnel type', async () => {
  const dialog = await openTunnel();
  const fields = dialog.map.children[0];
  const mode = option(fields, 'wireguard_mode');
  const type = option(fields, 'tunnel_type');
  expect(mode.formvalue('settings')).toBe('userspace');
  type.formvalue = () => 'warp';
  type.onchange(null, 'settings', 'warp');
  expect(mode.formvalue('settings')).toBe('userspace');

  mode.formvalue = () => 'kernel';
  type.formvalue = () => 'wireguard';
  type.onchange(null, 'settings', 'wireguard');
  expect(mode.formvalue('settings')).toBe('kernel');
});

describe('the WARP profile button', () => {
  it('fills the profile the router generated', async () => {
    harness.commands.generate_warp_profile = () =>
      Promise.resolve({
        code: 0,
        stdout: JSON.stringify({
          id: 'profile-id',
          auth_token: 'auth-token',
          private_key: 'private-key',
        }),
      });

    expect(await pressGenerate()).toEqual({
      id: 'profile-id',
      token: 'auth-token',
      key: 'private-key',
    });
    expect(harness.notifications).toEqual([]);
  });

  it('leaves a refused generation to the alert its log line raises', async () => {
    harness.commands.generate_warp_profile = () =>
      Promise.resolve({
        code: 1,
        stdout: '',
        stderr:
          'Failed to generate WARP profile: net/http: TLS handshake timeout\n',
      });

    const filled = await pressGenerate();

    expect(harness.notifications).toEqual([]);
    expect(filled.id ?? '').toBe('');
  });

  it('says why when the call never reached the router', async () => {
    harness.commands.generate_warp_profile = () =>
      Promise.reject(new Error('XHR request timed out'));

    await pressGenerate();

    expect(harness.notifications).toEqual([
      { title: 'Forkop Error', text: 'XHR request timed out', kind: 'error' },
    ]);
  });
});
