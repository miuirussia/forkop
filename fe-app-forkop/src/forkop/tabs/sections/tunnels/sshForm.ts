import { hostField, portField } from '../../../../validators/fields';
import { required } from '../../../cbi/required';

export function addSSHOptions(section: CBISection) {
  const add = (type: typeof form.Value, key: string, label: string) => {
    const option = section.option(type, `ssh_${key}`, label);
    option.depends('tunnel_type', 'ssh');
    option.rmempty = true;
    return option;
  };
  let o = add(form.Value, 'server', _('Server address'));
  o.validate = required(hostField);
  o = add(form.Value, 'server_port', _('Server port'));
  o.default = '22';
  o.validate = portField;
  o = add(form.Value, 'user', _('Username'));
  o.default = 'root';
  o = add(form.Value, 'password', _('Password'));
  o.password = true;
  o = add(form.TextValue, 'private_key', _('Private key'));
  o.rows = 5;
  o.password = true;
  add(form.Value, 'private_key_path', _('Private key path on router'));
  o = add(form.Value, 'private_key_passphrase', _('Private key passphrase'));
  o.password = true;
  o = add(form.DynamicList, 'host_key', _('SSH host keys'));
  o.description = _('If empty, any server host key is accepted.');
  add(form.DynamicList, 'host_key_algorithms', _('SSH host key algorithms'));
  add(form.Value, 'client_version', _('SSH client version'));
}
