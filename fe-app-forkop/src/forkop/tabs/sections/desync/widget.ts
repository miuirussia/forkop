import { E } from '../../../../helpers/element';
import { renderDesyncTools } from './tools';
import {
  DESYNC_MODES,
  DESYNC_PRESETS,
  exportDesync,
  importDesync,
  validateDesync,
} from './model';
import type { DesyncCapabilities, DesyncOptions } from './model';

type Kind = 'text' | 'number' | 'boolean' | 'json';
export function renderDesyncEditor(
  sourceNode: Node,
  source: HTMLTextAreaElement,
  sectionId: string,
  capabilities: DesyncCapabilities,
) {
  const error = E('p', { role: 'alert', tabindex: '-1' });
  const controls = new Map<
    string,
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >();
  function read() {
    return importDesync(source.value);
  }
  function report(reason: unknown) {
    error.textContent =
      reason instanceof Error ? reason.message : String(reason);
  }
  function sync() {
    try {
      const options = read();
      for (const [key, control] of controls) {
        const value = options[key];
        control.value =
          value === undefined
            ? ''
            : typeof value === 'object'
              ? JSON.stringify(value)
              : String(value);
      }
      const valid = validateDesync(options, capabilities);
      error.textContent = valid === true ? '' : valid;
    } catch (reason) {
      report(reason);
    }
  }
  function set(options: DesyncOptions) {
    source.value = JSON.stringify(options, null, 2);
    source.dispatchEvent(new Event('input', { bubbles: true }));
    source.dispatchEvent(new Event('change', { bubbles: true }));
    sync();
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
            E('option', { value: '' }, _('Inherit preset')),
            ...(choices || ['true', 'false']).map((value) =>
              E('option', { value }, value),
            ),
          ])
        : kind === 'json'
          ? E('textarea', { rows: 2, class: 'cbi-input-textarea' })
          : E('input', {
              type: kind === 'number' ? 'number' : 'text',
              class: 'cbi-input-text',
            });
    control.setAttribute('aria-label', label);
    controls.set(key, control);
    control.addEventListener('change', () => {
      try {
        const options = read();
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
        set(options);
      } catch (reason) {
        report(reason);
      }
    });
    const unavailable =
      capabilities.unsupported?.[key] ||
      (capabilities.parameters && !capabilities.parameters.includes(key)
        ? _('Unsupported by the installed core')
        : '');
    return E('label', { style: 'display:block;margin:0.65em 0' }, [
      E('span', { style: 'display:block' }, label),
      control,
      ...(unavailable
        ? [E('small', { style: 'display:block' }, unavailable)]
        : capabilities.requirements?.[key]
          ? [
              E(
                'small',
                { style: 'display:block' },
                capabilities.requirements[key],
              ),
            ]
          : []),
    ]);
  }
  const preset = row('preset', _('Preset'), 'text', DESYNC_PRESETS);
  const manual = E('details', {}, [
    E('summary', {}, _('Manual strategy')),
    E(
      'p',
      {},
      _(
        'Empty fields inherit the preset. Select auto_tune=false to keep a manual strategy fixed. Positions accept byte offsets and markers such as sni, midsld+1, host+1, endhost-1, sniext+1 and extlen.',
      ),
    ),
    row('mode', _('TCP mode'), 'text', DESYNC_MODES),
    row('delay', _('Delay (for example 100ms)')),
    row('fake_sni', _('Fake SNI')),
    row('fake_host', _('Fake HTTP Host')),
    row('repeats', _('Fake packet repetitions'), 'number'),
    row('ttl', _('Fake packet TTL'), 'number'),
    row('udp_mode', _('UDP mode'), 'text', ['none', 'quic', 'stun', 'auto']),
    row('udp_repeats', _('UDP fake repetitions'), 'number'),
    row('udp_ttl', _('UDP fake TTL'), 'number'),
    row('split_pos', _('Split positions')),
  ]);
  const advanced = E('details', {}, [
    E('summary', {}, _('Advanced parameters')),
    E(
      'p',
      {},
      _(
        'Unsupported settings are rejected with a reason. Desync requires its own direct socket and cannot connect through another outbound.',
      ),
    ),
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
    row('udp_fake_payload', _('Fake UDP payload (base64)')),
    row('udp_out_range', _('UDP packet range (inclusive)')),
    row('udp_keep_socket', _('Keep UDP socket'), 'boolean'),
    E(
      'p',
      {},
      _(
        'True sends fake packets through the retained UDP session socket. False opens a temporary raw injector for each fake series on Linux with CAP_NET_RAW. Both preserve the same source address and port; the session socket receives replies.',
      ),
    ),
    row('quic_desync', _('Enable QUIC desync'), 'boolean'),
    row(
      'quic_repeats',
      _('QUIC fake repetitions (0 inherits UDP repetitions)'),
      'number',
    ),
    E(
      'p',
      {},
      _(
        'QUIC desync is enabled by default in UDP modes quic and auto. False skips QUIC fake packets and resizing while auto mode still handles STUN. QUIC repetitions 1–16 override only QUIC series; 0 uses UDP repetitions.',
      ),
    ),
    row('udplen', _('UDP padding length'), 'number'),
  ]);
  const adaptive = E('details', {}, [
    E('summary', {}, _('Adaptive')),
    E(
      'p',
      {},
      _(
        'Adaptive chooses strategies for future connections and retries only eligible initial TLS data within configured limits. Learning uses cache.db when available and otherwise stays in memory.',
      ),
    ),
    row('auto_tune', _('Enable Adaptive (auto_tune)'), 'boolean'),
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
  const transfer = E('details', {}, [
    E('summary', {}, _('Import / export')),
    E(
      'p',
      {},
      _(
        'Import a JSON object or a key=value strategy. Import replaces the form strategy; explicit JSON fields override imported strategy values.',
      ),
    ),
    exchange,
    E('div', {}, [
      importButton,
      ' ',
      exportButton(_('Export JSON'), (value) => JSON.stringify(value, null, 2)),
      ' ',
      exportButton(_('Export string'), exportDesync),
    ]),
    E('details', {}, [
      E('summary', {}, _('Canonical options JSON')),
      sourceNode,
    ]),
  ]);
  source.addEventListener('input', sync);
  sync();
  return E('div', {}, [
    preset,
    manual,
    advanced,
    adaptive,
    transfer,
    error,
    renderDesyncTools(sectionId, read, set, capabilities),
  ]);
}
