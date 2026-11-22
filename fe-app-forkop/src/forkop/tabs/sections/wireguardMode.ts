export const WIREGUARD_TUNNEL_KINDS = ['wireguard', 'amneziawg', 'phobos'];
export const WIREGUARD_MODE_TUNNEL_KINDS = [...WIREGUARD_TUNNEL_KINDS, 'warp'];

export function wireGuardModeOptions(mode: unknown) {
  if (mode === 'kernel') return { kernel: true };
  if (mode === 'system') return { system: true };
  return mode === 'userspace' ? { system: false } : {};
}

export function addWireGuardModeOption(section: CBISection) {
  const mode = section.option(
    form.ListValue,
    'wireguard_mode',
    _('WireGuard mode'),
    _(
      'Kernel uses a Linux module and falls back to Userspace if the module or configuration does not support it.',
    ),
  );
  mode.value('userspace', 'Userspace');
  mode.value('system', 'System');
  mode.value('kernel', 'Kernel');
  mode.default = 'userspace';
  mode.rmempty = false;
  mode.write = function (itemId: string, value: unknown) {
    if (value === this.default) {
      return this.remove(itemId);
    }
    return form.ListValue.prototype.write.call(this, itemId, value);
  };
  return mode;
}
