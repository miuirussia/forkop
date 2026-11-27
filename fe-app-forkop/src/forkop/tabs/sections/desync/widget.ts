import { E } from '../../../../helpers/element';
import { renderDesyncTools } from './tools';
import {
  desyncActions,
  desyncField,
  desyncGroup,
  desyncPanel,
  desyncTabs,
} from './ui';
import {
  DESYNC_MODES,
  DESYNC_PRESETS,
  exportDesync,
  importDesync,
  validateDesync,
} from './model';
import type { DesyncCapabilities, DesyncOptions } from './model';

type Kind = 'text' | 'number' | 'boolean' | 'json';
const editorValidators = new WeakMap<Node, () => true | string>();

export function validateDesyncEditor(node?: Node) {
  return (node && editorValidators.get(node)?.()) || true;
}

export function renderDesyncEditor(
  sourceNode: Node,
  source: HTMLTextAreaElement,
  sectionId: string,
  capabilities: DesyncCapabilities,
) {
  const errorId = `desync-error-${sectionId}`;
  const error = E('p', {
    id: errorId,
    class: 'fkp-desync__error',
    role: 'alert',
    tabindex: '-1',
  });
  const choiceLabels: Record<string, string> = {
    auto: _('Automatic selection (auto)'),
    custom: _('Custom settings (custom)'),
    none: _('Disabled (none)'),
    split: _('TCP segmentation (split)'),
    disorder: _('Out-of-order segments (disorder)'),
    tlsrec: _('TLS record fragmentation (tlsrec)'),
    fake: _('Fake packets (fake)'),
    fake_split: _('Fake packets + segmentation (fake_split)'),
    oob: _('TCP urgent data (oob)'),
    multi_split: _('Multiple segments (multi_split)'),
    fake_disorder: _('Fake packets + reordering (fake_disorder)'),
    multi_disorder: _('Multiple reordered segments (multi_disorder)'),
    disoob: _('Reordering + urgent data (disoob)'),
    hostfakesplit: _('Fake HTTP Host + segmentation (hostfakesplit)'),
    quic: _('QUIC only (quic)'),
    stun: _('STUN only (stun)'),
    GT1: _('Game traffic profile 1 (GT1)'),
    GT2: _('Game traffic profile 2 (GT2)'),
    GT3: _('Game traffic profile 3 (GT3)'),
    GT4: _('Game traffic profile 4 (GT4)'),
    true: _('Enabled'),
    false: _('Disabled'),
  };
  const controls = new Map<
    string,
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >();
  const drafts = new Map<string, string>();
  let updating = false;
  let editedKey: string | undefined;
  editorValidators.set(sourceNode, () => drafts.values().next().value || true);
  function read() {
    const invalid = drafts.values().next().value;
    if (invalid) throw new Error(invalid);
    return importDesync(source.value);
  }
  function report(reason: unknown, fieldKey?: string) {
    const message = reason instanceof Error ? reason.message : String(reason);
    error.textContent = [
      ...new Set([...drafts.values(), message].filter(Boolean)),
    ].join('\n');
    const key = fieldKey || message.split(':', 1)[0];
    for (const [name, control] of controls) {
      control.setAttribute(
        'aria-invalid',
        String(drafts.has(name) || name === key),
      );
    }
  }
  function sync() {
    try {
      const options = importDesync(source.value);
      for (const [key, control] of controls) {
        if (drafts.has(key) || key === editedKey) continue;
        const value = options[key];
        control.value =
          value === undefined
            ? key === 'preset'
              ? 'auto'
              : ''
            : typeof value === 'object'
              ? JSON.stringify(value)
              : String(value);
      }
      const valid = validateDesync(options, capabilities);
      report(valid === true ? '' : valid);
    } catch (reason) {
      report(reason);
    }
  }
  function set(options: DesyncOptions, key?: string) {
    if (!key) drafts.clear();
    editedKey = key;
    updating = true;
    try {
      source.value = JSON.stringify(options, null, 2);
      source.dispatchEvent(new Event('input', { bubbles: true }));
      source.dispatchEvent(new Event('change', { bubbles: true }));
      sync();
    } finally {
      updating = false;
      editedKey = undefined;
    }
  }
  function row(
    key: string,
    label: string,
    kind: Kind = 'text',
    choices?: string[],
  ) {
    const control =
      choices || kind === 'boolean'
        ? E('select', { class: 'cbi-input-select' }, [
            ...(key === 'preset'
              ? []
              : [E('option', { value: '' }, _('Inherit preset'))]),
            ...(choices || ['true', 'false']).map((value) =>
              E(
                'option',
                { value },
                key === 'udp_mode' && value === 'auto'
                  ? _('QUIC and STUN (auto)')
                  : choiceLabels[value] || value,
              ),
            ),
          ])
        : kind === 'json'
          ? E('textarea', { rows: 2, class: 'cbi-input-textarea' })
          : E('input', {
              type: kind === 'number' ? 'number' : 'text',
              class: 'cbi-input-text',
            });
    control.setAttribute('aria-label', label);
    control.setAttribute('aria-describedby', errorId);
    controls.set(key, control);
    const update = () => {
      try {
        const options = importDesync(source.value);
        if (
          kind === 'number' &&
          (control as HTMLInputElement).validity?.badInput
        )
          throw new Error(_('%s: needs a whole number').format(key));
        const value = control.value.trim();
        if (!value) delete options[key];
        else
          options[key] =
            kind === 'boolean'
              ? value === 'true'
              : kind === 'number'
                ? Number(value)
                : kind === 'json'
                  ? JSON.parse(value)
                  : value;
        if (key === 'preset') {
          if (value === 'custom') {
            options.auto_tune = false;
            delete options.adaptive;
          } else if (value === 'auto') options.auto_tune = true;
        }
        drafts.delete(key);
        set(options, key);
      } catch (reason) {
        const message =
          reason instanceof Error ? reason.message : String(reason);
        drafts.set(
          key,
          message.startsWith(`${key}:`) ? message : `${key}: ${message}`,
        );
        report(drafts.get(key)!, key);
      }
    };
    control.addEventListener('input', update);
    control.addEventListener('change', update);
    const unavailable =
      capabilities.unsupported?.[key] ||
      (capabilities.parameters && !capabilities.parameters.includes(key)
        ? _('Unsupported by the installed core')
        : '');
    const field = desyncField(label, control);
    if (unavailable || capabilities.requirements?.[key]) {
      field.append(
        E('small', {}, unavailable || capabilities.requirements![key]),
      );
    }
    return field;
  }
  const fields = (children: HTMLElement[]) =>
    E('div', { class: 'fkp-desync__fields' }, children);
  const preset = E(
    'div',
    { class: 'fkp-desync__preset' },
    row('preset', _('Strategy profile'), 'text', DESYNC_PRESETS),
  );
  const manual = desyncGroup(_('TCP and TLS'), [
    E(
      'p',
      {},
      _(
        'Empty fields use the selected profile. To keep a fixed strategy, disable automatic selection in Adaptive mode.',
      ),
    ),
    fields([
      row('mode', _('TCP mode'), 'text', DESYNC_MODES),
      row('split_pos', _('Split positions')),
      row('delay', _('Delay (for example 100ms)')),
      row('fake_sni', _('Fake SNI')),
      row('fake_host', _('Fake HTTP Host')),
      row('repeats', _('Fake packet repetitions'), 'number'),
      row('ttl', _('Fake packet TTL'), 'number'),
    ]),
    E(
      'p',
      {},
      _(
        'Split positions accept byte offsets and markers: sni, midsld+1, host+1, endhost-1, sniext+1, extlen.',
      ),
    ),
  ]);
  const advancedTcp = desyncGroup(_('Advanced TCP settings'), [
    E(
      'p',
      {},
      _(
        'Unsupported settings are rejected with a reason. Desync requires its own direct socket and cannot connect through another outbound.',
      ),
    ),
    fields([
      row('fooling', _('Fooling methods')),
      row('tlsrec_first', _('Split TLS records first'), 'boolean'),
      row('seqovl', _('Sequence overlap (bytes)'), 'number'),
      row('autottl', _('Automatic TTL'), 'boolean'),
      row('fake_payload', _('Fake TCP payload (base64)')),
      row('fake_sni_pool', _('Fake SNI pool (JSON array)'), 'json'),
      row('ipfrag', _('IP fragment size'), 'number'),
      row('syndata', _('SYN data (base64)')),
      row('wsize', _('TCP window size'), 'number'),
      row('wscale', _('TCP window scale'), 'number'),
    ]),
  ]);
  const udp = desyncGroup(_('UDP and QUIC'), [
    fields([
      row('udp_mode', _('UDP mode'), 'text', ['none', 'quic', 'stun', 'auto']),
      row('udp_repeats', _('UDP fake repetitions'), 'number'),
      row('udp_ttl', _('UDP fake TTL'), 'number'),
      row('quic_desync', _('Enable QUIC desync'), 'boolean'),
      row(
        'quic_repeats',
        _('QUIC fake repetitions (0 inherits UDP repetitions)'),
        'number',
      ),
      row('udplen', _('UDP padding length'), 'number'),
    ]),
    E(
      'p',
      {},
      _(
        'QUIC desync is enabled by default in UDP modes quic and auto. False skips QUIC fake packets and resizing while auto mode still handles STUN. QUIC repetitions 1–16 override only QUIC series; 0 uses UDP repetitions.',
      ),
    ),
  ]);
  const adaptive = desyncGroup(_('Adaptive mode'), [
    E(
      'p',
      {},
      _(
        'Adaptive chooses strategies for future connections and retries only eligible initial TLS data within configured limits. Learning uses cache.db when available and otherwise stays in memory.',
      ),
    ),
    fields([row('auto_tune', _('Automatic strategy selection'), 'boolean')]),
  ]);
  const advancedUdp = desyncGroup(_('Advanced UDP settings'), [
    fields([
      row('udp_fake_payload', _('Fake UDP payload (base64)')),
      row('udp_out_range', _('UDP packet range (inclusive)')),
      row('udp_keep_socket', _('Keep UDP socket'), 'boolean'),
    ]),
    E(
      'p',
      {},
      _(
        'True sends fake packets through the retained UDP session socket. False opens a temporary raw injector for each fake series on Linux with CAP_NET_RAW. Both preserve the same source address and port; the session socket receives replies.',
      ),
    ),
  ]);
  const advancedAdaptive = desyncGroup(_('Adaptive mode'), [
    row('adaptive', _('Adaptive limits (JSON object)'), 'json'),
    E(
      'p',
      {},
      _(
        'Adaptive keys: max_attempts, max_concurrent, max_entries, ttl, timeout, max_buffer, network_id. Durations include a unit, for example 5s or 24h.',
      ),
    ),
  ]);
  const exchange = E('textarea', {
    rows: 5,
    class: 'cbi-input-textarea',
    'aria-label': _('Strategy import or export'),
  });
  const importButton = E(
    'button',
    {
      type: 'button',
      class: 'btn cbi-button',
      click: () => {
        try {
          const options = importDesync(exchange.value);
          const valid = validateDesync(options, capabilities);
          if (valid !== true) throw new Error(valid);
          set(options);
        } catch (reason) {
          report(reason);
          error.focus();
        }
      },
    },
    _('Import strategy'),
  );
  const exportButton = (
    label: string,
    stringify: (options: DesyncOptions) => string,
  ) =>
    E(
      'button',
      {
        type: 'button',
        class: 'btn cbi-button',
        click: () => {
          try {
            exchange.value = stringify(read());
            exchange.focus();
            exchange.select();
          } catch (reason) {
            report(reason);
          }
        },
      },
      label,
    );
  const transfer = desyncGroup(_('Import and export'), [
    E(
      'p',
      {},
      _(
        'Import a JSON object or a key=value strategy. Import replaces the form strategy; explicit JSON fields override imported strategy values.',
      ),
    ),
    exchange,
    desyncActions([
      importButton,
      exportButton(_('Export JSON'), (value) => JSON.stringify(value, null, 2)),
      exportButton(_('Export string'), exportDesync),
    ]),
    desyncGroup(_('Strategy JSON'), [sourceNode as HTMLElement]),
  ]);
  source.addEventListener('input', () => {
    if (!updating) drafts.clear();
    sync();
  });
  sync();
  const tools = renderDesyncTools(
    sectionId,
    read,
    set,
    capabilities,
    choiceLabels,
  );
  const parameters = E('div', {}, [
    preset,
    manual,
    udp,
    adaptive,
    desyncPanel(_('Advanced settings'), [
      advancedTcp,
      advancedUdp,
      advancedAdaptive,
      transfer,
    ]),
  ]);
  return E('div', { class: 'fkp-desync' }, [
    error,
    tools.error,
    desyncTabs(`desync-${sectionId}`, [
      { key: 'parameters', label: _('Parameters'), content: parameters },
      { key: 'testing', label: _('Strategy testing'), content: tools.testing },
    ]),
  ]);
}
