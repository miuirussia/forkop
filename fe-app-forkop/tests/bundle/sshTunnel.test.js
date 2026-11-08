import { beforeEach, describe, expect, it } from 'vitest';
import { coreFeatures } from '../lib/coreFeatures.js';
import { createHarness } from '../lib/luciForm.js';

let harness;
const option = (section, name) =>
  section.children.find((o) => o.option === name);
beforeEach(() => {
  harness = createHarness();
  harness.bundle.setCoreFeatures(coreFeatures({ add: ['with_ssh'] }));
  harness.uci.add('forkop', 'section', 'sec');
  Object.assign(harness.store.get('sec'), {
    action: 'connection',
    enabled: '1',
  });
});
async function dialogFor(value, context = {}) {
  const map = new harness.form.Map('forkop');
  const section = map.section(harness.form.GridSection, 'section');
  delete section.load;
  harness.bundle.createSectionContent(section);
  const dialog = await harness.openDialog(
    option(section, 'tunnels'),
    'sec',
    value,
    context,
  );
  const fields = dialog.map.children[0];
  fields.children.forEach((field) => {
    field.formvalue = (sid) =>
      dialog.map.data.get(dialog.map.config, sid, field.option) ?? null;
  });
  return { ...dialog, fields };
}

describe('SSH in Add tunnel', () => {
  it('offers SSH and saves a new connection', async () => {
    const dialog = await dialogFor('', { adding: true });
    expect(option(dialog.fields, 'tunnel_type').keylist).toContain('ssh');
    for (const [key, value] of Object.entries({
      tunnel_type: 'ssh',
      name: 'SSH',
      ssh_server: 'ssh.example.com',
      ssh_password: 'secret',
    })) {
      dialog.map.data.set(dialog.map.config, 'settings', key, value);
    }
    expect((await dialog.save()).saved).toBe(true);
    const tunnel = harness.uci.sections('forkop', 'tunnel')[0];
    expect(tunnel.kind).toBe('ssh');
    expect(JSON.parse(tunnel.endpoint_json)).toEqual({
      type: 'ssh',
      server: 'ssh.example.com',
      server_port: 22,
      user: 'root',
      password: 'secret',
    });
  });
  it('restores and saves multiline keys', async () => {
    const outbound = {
      type: 'ssh',
      server: 'ssh.example.com',
      server_port: 22,
      user: 'alice',
      private_key: 'KEY\nLINE\n',
      private_key_passphrase: 'secret',
    };
    harness.uci.add('forkop', 'tunnel', 'ssh');
    Object.assign(harness.store.get('ssh'), {
      section: 'sec',
      kind: 'ssh',
      name: 'SSH',
      endpoint_json: JSON.stringify(outbound),
    });
    const dialog = await dialogFor('ssh');
    expect(
      dialog.map.data.get(dialog.map.config, 'settings', 'ssh_private_key'),
    ).toBe(outbound.private_key);
    expect((await dialog.save()).saved).toBe(true);
    expect(JSON.parse(harness.store.get('ssh').endpoint_json)).toEqual(
      outbound,
    );
  });
  it('keeps a saved SSH visible but refuses saving without with_ssh', async () => {
    harness.bundle.setCoreFeatures(coreFeatures());
    const fresh = await dialogFor('', { adding: true });
    expect(option(fresh.fields, 'tunnel_type').keylist).not.toContain('ssh');
    harness.uci.add('forkop', 'tunnel', 'ssh');
    Object.assign(harness.store.get('ssh'), {
      section: 'sec',
      kind: 'ssh',
      name: 'SSH',
      endpoint_json: '{"type":"ssh","server":"ssh.example.com"}',
    });
    const saved = await dialogFor('ssh');
    expect(option(saved.fields, 'tunnel_type').keylist).toContain('ssh');
    expect((await saved.save()).saved).toBe(false);
  });
});
