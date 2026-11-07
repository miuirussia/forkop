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
});
