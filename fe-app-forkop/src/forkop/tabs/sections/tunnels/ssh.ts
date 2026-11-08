import { hostField, portField } from '../../../../validators/fields';
import { message } from '../../../../validators/messages';
import { normalizeOptionValues } from '../../../cbi/listValues';

const STRINGS = [
  'server',
  'user',
  'password',
  'private_key',
  'private_key_path',
  'private_key_passphrase',
  'client_version',
];
const LISTS = ['host_key', 'host_key_algorithms'];

export function sshInitialSettings(outbound: Record<string, unknown>) {
  const settings: ChildSettings = {};
  STRINGS.forEach((key) => {
    settings[`ssh_${key}`] = `${outbound[key] ?? ''}`;
  });
  LISTS.forEach((key) => {
    settings[`ssh_${key}`] = normalizeOptionValues(outbound[key]);
  });
  settings.ssh_server_port = `${outbound.server_port ?? 22}`;
  settings.ssh_user ||= 'root';
  return settings;
}

export function sshOutbound(settings: ChildSettings) {
  const outbound: Record<string, unknown> = { type: 'ssh' };
  STRINGS.forEach((key) => {
    const value = `${settings[`ssh_${key}`] ?? ''}`;
    if (value)
      outbound[key] = [
        'server',
        'user',
        'private_key_path',
        'client_version',
      ].includes(key)
        ? value.trim()
        : value;
  });
  outbound.user ||= 'root';
  outbound.server_port = Number(
    `${settings.ssh_server_port ?? ''}`.trim() || 22,
  );
  LISTS.forEach((key) => {
    const values = normalizeOptionValues(settings[`ssh_${key}`]);
    if (values.length) outbound[key] = values;
  });
  return outbound;
}

export function validateSSHSettings(settings: ChildSettings) {
  if (!`${settings.ssh_server || ''}`.trim()) return message.fixSettings();
  const host = hostField('', settings.ssh_server);
  return host === true ? portField('', settings.ssh_server_port) : host;
}
