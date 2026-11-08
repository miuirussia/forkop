import { describe, expect, it } from 'vitest';
import { sshInitialSettings, sshOutbound, validateSSHSettings } from '../ssh';

describe('SSH tunnel form', () => {
  it('round trips credentials, multiline keys and host verification', () => {
    const outbound = {
      type: 'ssh',
      server: 'vpn.example.com',
      server_port: 2222,
      user: 'alice',
      password: ' secret ',
      private_key:
        '-----BEGIN OPENSSH PRIVATE KEY-----\nKEY\n-----END OPENSSH PRIVATE KEY-----\n',
      private_key_path: '/etc/ssh/key',
      private_key_passphrase: ' passphrase ',
      host_key: ['ssh-ed25519 AAAA'],
      host_key_algorithms: ['ssh-ed25519'],
      client_version: 'SSH-2.0-OpenSSH_7.4p1',
    };
    expect(sshOutbound(sshInitialSettings(outbound))).toEqual(outbound);
  });
  it('uses the sing-box defaults without requiring credentials', () => {
    expect(sshOutbound({ ssh_server: '::1' })).toEqual({
      type: 'ssh',
      server: '::1',
      server_port: 22,
      user: 'root',
    });
    expect(validateSSHSettings({ ssh_server: '::1' })).toBe(true);
  });
  it('uses the default port for a whitespace-only optional field', () => {
    const settings = { ssh_server: 'ssh.example.com', ssh_server_port: '   ' };
    expect(validateSSHSettings(settings)).toBe(true);
    expect(sshOutbound(settings).server_port).toBe(22);
  });
  it.each(['', 'https://example.com', 'not a host'])(
    'rejects server %s',
    (ssh_server) => {
      expect(validateSSHSettings({ ssh_server })).not.toBe(true);
    },
  );
  it.each(['0', '65536', '22.5', 'abc'])(
    'rejects port %s',
    (ssh_server_port) => {
      expect(
        validateSSHSettings({ ssh_server: 'vpn.example.com', ssh_server_port }),
      ).not.toBe(true);
    },
  );
});
