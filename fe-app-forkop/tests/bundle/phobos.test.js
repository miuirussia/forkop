import { describe, expect, it } from 'vitest';
import { createHarness } from '../lib/luciForm.js';
const config = `[Interface]
PrivateKey = AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
Address = 10.8.0.2/32
[Peer]
PublicKey = AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=
AllowedIPs = 0.0.0.0/0
Endpoint = 127.0.0.1:13255
[instance]
target = vpn.example.com:51824
key = secret
max-dummy = 0
`;
const uri = `phobos://${Buffer.from(config).toString('base64url')}#Home`;
function setup() {
  const h = createHarness();
  h.uci.add('forkop', 'section', 'sec');
  Object.assign(h.store.get('sec'), { action: 'connection', enabled: '1' });
  const map = new h.form.Map('forkop');
  const grid = map.section(h.form.GridSection, 'section');
  h.bundle.createSectionContent(grid);
  const links = grid.children.find((o) => o.option === 'connection_link');
  const tunnels = grid.children.find((o) => o.option === 'tunnels');
  tunnels.getUIElement = () => ({});
  tunnels.formvalue = () =>
    h.uci.sections('forkop', 'tunnel').map((t) => t['.name']);
  return { h, links, tunnels };
}

async function openPhobos(link = uri) {
  const { h, links, tunnels } = setup();
  links.createTypedItem('sec', link);
  const tunnel = h.uci.sections('forkop', 'tunnel')[0];
  const dialog = await h.openDialog(tunnels, 'sec', tunnel['.name']);
  const fields = Object.fromEntries(
    dialog.map.children[0].children.map((field) => [field.option, field]),
  );
  for (const name of ['phobos_masking', 'phobos_obfuscation']) {
    const field = fields[name];
    let value = field.cfgvalue('settings');
    field.formvalue = () => value;
    field.getUIElement = () => ({
      setValue: (next) => (value = next),
      triggerValidation() {},
    });
  }
  function change(name, value) {
    fields[name].getUIElement().setValue(value);
    fields[name].onchange(null, 'settings', value);
  }
  return { h, tunnel, dialog, fields, change, tunnels };
}

describe('Phobos pasted in Connection URI', () => {
  it('creates a tunnel and peer, keeps names unique and can reopen/save it', async () => {
    const { h, links, tunnels } = setup();
    expect(links.validate('sec', uri)).toBe(true);
    expect(links.createTypedItem('sec', uri)).toBe('');
    expect(h.uci.sections('forkop', 'connection_link')).toHaveLength(0);
    const tunnel = h.uci.sections('forkop', 'tunnel')[0];
    expect(tunnel.kind).toBe('phobos');
    expect(tunnel.name).toBe('Home');
    expect(JSON.parse(tunnel.phobos_obfuscation)).toEqual({
      key: 'secret',
      max_dummy: 0,
    });
    expect(h.uci.sections('forkop', 'tunnel_peer')[0]).toMatchObject({
      address: 'vpn.example.com',
      port: '51824',
    });
    const dialog = await h.openDialog(tunnels, 'sec', tunnel['.name']);
    await dialog.save();
    expect(h.uci.sections('forkop', 'tunnel_peer')).toHaveLength(1);
    links.createTypedItem('sec', uri);
    expect(h.uci.sections('forkop', 'tunnel').map((t) => t.name)).toEqual([
      'Home',
      'Home #1',
    ]);
  });
  it('refuses a broken payload before creating UCI children', () => {
    const { h, links } = setup();
    expect(() => links.createTypedItem('sec', 'phobos://broken')).toThrow(
      'Invalid Phobos link',
    );
    expect(h.uci.sections('forkop', 'tunnel')).toHaveLength(0);
    expect(h.uci.sections('forkop', 'tunnel_peer')).toHaveLength(0);
  });

  it.each(['STUN', 'MEDIA', 'AUTO', 'NONE'])(
    'saves and reopens the selected %s masking without losing other parameters',
    async (mode) => {
      const { h, tunnel, dialog, fields, change, tunnels } = await openPhobos();
      expect(fields.phobos_masking.keylist).toEqual([
        '',
        'STUN',
        'MEDIA',
        'AUTO',
        'NONE',
      ]);
      expect(fields.phobos_masking.deps).toEqual([{ tunnel_type: 'phobos' }]);
      change('phobos_masking', mode);
      expect(JSON.parse(fields.phobos_obfuscation.formvalue())).toEqual({
        key: 'secret',
        max_dummy: 0,
        masking: mode,
      });
      expect(await dialog.save()).toEqual({ saved: true });
      expect(JSON.parse(tunnel.phobos_obfuscation)).toEqual({
        key: 'secret',
        max_dummy: 0,
        masking: mode,
      });
      expect(tunnel).not.toHaveProperty('phobos_masking');
      const reopened = await h.openDialog(tunnels, 'sec', tunnel['.name']);
      expect(
        reopened.map.children[0].children
          .find((field) => field.option === 'phobos_masking')
          .cfgvalue('settings'),
      ).toBe(mode);
    },
  );

  it('reads masking from the imported link and preserves an unchanged save', async () => {
    const link = `phobos://${Buffer.from(`${config}masking = media\n`).toString('base64url')}`;
    const { h, tunnel, dialog, fields } = await openPhobos(link);
    const stored = tunnel.phobos_obfuscation;
    expect(fields.phobos_masking.formvalue()).toBe('MEDIA');
    h.operations.length = 0;
    expect(await dialog.save()).toEqual({ saved: true });
    expect(tunnel.phobos_obfuscation).toBe(stored);
    expect(
      h.operations.filter((operation) =>
        operation.startsWith(`set ${tunnel['.name']}.`),
      ),
    ).toEqual([]);
  });

  it('updates the selection when JSON changes and can restore the default', async () => {
    const { tunnel, dialog, fields, change } = await openPhobos();
    change(
      'phobos_obfuscation',
      JSON.stringify({ key: 'changed', max_dummy: 0, masking: 'STUN' }),
    );
    expect(fields.phobos_masking.formvalue()).toBe('STUN');
    change('phobos_masking', '');
    expect(await dialog.save()).toEqual({ saved: true });
    expect(JSON.parse(tunnel.phobos_obfuscation)).toEqual({
      key: 'changed',
      max_dummy: 0,
    });
  });
});

async function openSavedLink(link = uri) {
  const { h, links } = setup();
  h.uci.add('forkop', 'connection_link', 'saved');
  const stored = h.store.get('saved');
  Object.assign(stored, { section: 'sec', name: 'work', uri: link });
  const dialog = await h.openDialog(links, 'sec', 'saved');
  const fields = Object.fromEntries(
    dialog.map.children[0].children.map((field) => [field.option, field]),
  );
  for (const name of ['uri', 'phobos_masking']) {
    const field = fields[name];
    let value = field.cfgvalue('settings');
    field.formvalue = () => value;
    field.getUIElement = () => ({
      setValue: (next) => (value = next),
      triggerValidation() {},
    });
  }
  const change = (name, value) => {
    fields[name].getUIElement().setValue(value);
    fields[name].onchange(null, 'settings', value);
  };
  return { h, links, stored, dialog, fields, change };
}

describe('Phobos saved as a connection link', () => {
  it.each(['STUN', 'MEDIA', 'AUTO', 'NONE'])(
    'shows, saves and reopens %s masking in the server dialog',
    async (mode) => {
      const { h, links, stored, dialog, fields, change } =
        await openSavedLink();
      expect(fields.phobos_masking.isActive('settings')).toBe(true);
      expect(fields.phobos_masking.keylist).toEqual([
        '',
        'STUN',
        'MEDIA',
        'AUTO',
        'NONE',
      ]);
      change('phobos_masking', mode);
      expect(await dialog.save()).toEqual({ saved: true });
      expect(stored.uri.endsWith('#Home')).toBe(true);
      expect(
        Buffer.from(stored.uri.slice(9).split('#')[0], 'base64url').toString(),
      ).toBe(config.replace('[instance]', `[instance]\nmasking = ${mode}`));
      expect(stored).not.toHaveProperty('phobos_masking');
      const reopened = await h.openDialog(links, 'sec', 'saved');
      expect(
        reopened.map.children[0].children
          .find((field) => field.option === 'phobos_masking')
          .cfgvalue('settings'),
      ).toBe(mode);
    },
  );

  it('preserves an unchanged URI and reads its masking', async () => {
    const link = `phobos://${Buffer.from(`${config}masking = media\n`).toString('base64url')}#work`;
    const { h, stored, dialog, fields } = await openSavedLink(link);
    expect(fields.phobos_masking.formvalue()).toBe('MEDIA');
    h.operations.length = 0;
    expect(await dialog.save()).toEqual({ saved: true });
    expect(stored.uri).toBe(link);
    expect(h.operations).toEqual([]);
  });

  it.each(['', 'MEDIA'])(
    'saves a manually restored URI with original masking %j',
    async (mode) => {
      const source = mode ? `${config}masking = ${mode}\n` : config;
      const original = `phobos://${Buffer.from(source).toString('base64url')}#Home`;
      const { h, stored, dialog, fields, change } =
        await openSavedLink(original);
      h.operations.length = 0;

      change('phobos_masking', 'NONE');
      expect(fields.uri.formvalue()).not.toBe(original);
      change('uri', original);
      expect(fields.phobos_masking.formvalue()).toBe(mode);

      expect(await dialog.save()).toEqual({ saved: true });
      expect(stored.uri).toBe(original);
      expect(h.operations).toEqual([]);
    },
  );

  it('follows edited URIs and removes masking when Default is selected', async () => {
    const { stored, dialog, fields, change } = await openSavedLink();
    change(
      'uri',
      `phobos://${Buffer.from(`${config}masking = STUN\n`).toString('base64url')}#Changed`,
    );
    expect(fields.phobos_masking.formvalue()).toBe('STUN');
    change('phobos_masking', '');
    expect(await dialog.save()).toEqual({ saved: true });
    expect(stored.uri).toBe(
      `phobos://${Buffer.from(config).toString('base64url')}#Changed`,
    );
  });

  it('hides masking for other connection protocols', async () => {
    const link = 'socks5://127.0.0.1:1080#proxy';
    const { stored, dialog, fields } = await openSavedLink(link);
    expect(fields.phobos_masking.isActive('settings')).toBe(false);
    expect(await dialog.save()).toEqual({ saved: true });
    expect(stored.uri).toBe(link);
  });
});
