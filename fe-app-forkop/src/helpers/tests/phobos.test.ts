import { describe, expect, it } from 'vitest';
import {
  parsePhobosLink,
  validPhobosObfuscation,
} from '../parseWireGuardConfig';
const conf = `[Interface]
PrivateKey = AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
Address = 10.8.0.2/32, fd00::2/128
MTU = 1280
[Peer]
PublicKey = AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 0
Endpoint = 127.0.0.1:13255
[instance]
target = [2001:db8::1]:51824
key = test-key
masking = MEDIA
max-dummy = 0
obfuscate-bytes = 0
media-ssrc = 305419896
`;
const link = (text: string) =>
  `phobos://${btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')}#%D0%A3%D0%B7%D0%B5%D0%BB`;
describe('Phobos WireGuard import', () => {
  it('uses the remote target and preserves IPv6, MTU and explicit zeros', () => {
    const result = parsePhobosLink(link(conf));
    expect(result.valid).toBe(true);
    if (!result.valid) throw Error(result.message);
    expect(result.endpoint.type).toBe('phobos');
    expect(result.endpoint.address).toEqual(['10.8.0.2/32', 'fd00::2/128']);
    expect(result.endpoint.mtu).toBe(1280);
    expect(result.endpoint.peers[0]).toMatchObject({
      address: '2001:db8::1',
      port: 51824,
      persistent_keepalive_interval: 0,
    });
    expect(result.endpoint.obfuscation).toEqual({
      key: 'test-key',
      masking: 'MEDIA',
      max_dummy: 0,
      obfuscate_bytes: 0,
      media_ssrc: 305419896,
    });
  });
  it.each([
    conf.replace('target = [2001:db8::1]:51824', ''),
    conf.replace('key = test-key', ''),
    conf.replace('max-dummy = 0', 'max-dummy = 1025'),
    conf.replace('[instance]', '[other]'),
    conf.replace('[Peer]', '[other]'),
    conf.replace('masking = MEDIA', 'masking = TLS'),
    conf.replace('target = [2001:db8::1]:51824', 'target = host:65536'),
  ])('refuses an invalid config without returning credentials', (text) => {
    expect(parsePhobosLink(link(text))).toEqual({
      valid: false,
      message: 'Invalid Phobos link',
    });
  });
  it('uses defaults for the specification’s none placeholders', () => {
    const result = parsePhobosLink(
      link(
        conf
          .replace('MTU = 1280', 'MTU = none')
          .replace('max-dummy = 0', 'max-dummy = none') + 'verbose = none\n',
      ),
    );
    expect(result.valid).toBe(true);
    if (!result.valid) throw Error(result.message);
    expect(result.endpoint.mtu).toBeUndefined();
    expect(result.endpoint.obfuscation.max_dummy).toBeUndefined();
  });
  it('reports SOCKS5 explicitly', () => {
    expect(parsePhobosLink(link('[instance]\nmode = socks5'))).toEqual({
      valid: false,
      message: 'Phobos SOCKS5 is not supported',
    });
  });
  it.each(['phobos://!', 'phobos://A', 'phobos://', 'phobos://_w'])(
    'refuses invalid payload %s',
    (value) => {
      expect(parsePhobosLink(value).valid).toBe(false);
    },
  );
  it('checks limits and UTF-8 key length', () => {
    expect(validPhobosObfuscation({ key: 'я'.repeat(128) })).toBe(false);
    expect(validPhobosObfuscation({ key: 'key', media_clock: 1001 })).toBe(
      false,
    );
    expect(validPhobosObfuscation({ key: 'key', max_dummy: 0 })).toBe(true);
  });
});
