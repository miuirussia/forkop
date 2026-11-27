// Canonical strategy object shared with the core. No UI-only values are stored here.
export type DesyncOptions = Record<string, unknown>;
export const DESYNC_PRESETS = [
  'auto',
  'custom',
  'split',
  'disorder',
  'tlsrec',
  'fake',
  'fake_split',
  'oob',
  'GT1',
  'GT2',
  'GT3',
  'GT4',
];
export const DESYNC_MODES = [
  'none',
  'split',
  'disorder',
  'tlsrec',
  'fake',
  'fake_split',
  'oob',
  'multi_split',
  'fake_disorder',
  'multi_disorder',
  'disoob',
  'hostfakesplit',
];
export const DESYNC_KEYS = [
  'preset',
  'mode',
  'split_pos',
  'fake_sni',
  'fake_host',
  'fake_payload',
  'fake_sni_pool',
  'repeats',
  'delay',
  'ttl',
  'fooling',
  'tlsrec_first',
  'seqovl',
  'autottl',
  'ipfrag',
  'syndata',
  'wsize',
  'wscale',
  'udp_mode',
  'udp_fake_payload',
  'udp_ttl',
  'udp_repeats',
  'udp_out_range',
  'udp_keep_socket',
  'quic_desync',
  'quic_repeats',
  'udplen',
  'auto_tune',
  'adaptive',
  'strategy',
];
const BOOLEAN_KEYS = new Set([
  'tlsrec_first',
  'autottl',
  'udp_keep_socket',
  'quic_desync',
  'auto_tune',
]);
const NUMBER_LIMITS: Record<string, [number, number]> = {
  repeats: [1, 16],
  ttl: [1, 255],
  seqovl: [0, 65535],
  ipfrag: [0, 65535],
  wsize: [0, 65535],
  wscale: [0, 14],
  udp_ttl: [1, 255],
  udp_repeats: [1, 16],
  quic_repeats: [0, 16],
  udplen: [0, 65507],
};
const ADAPTIVE_LIMITS: Record<string, [number, number]> = {
  max_attempts: [1, 8],
  max_concurrent: [1, 16],
  max_entries: [16, 16384],
  max_buffer: [512, 65536],
};
export interface DesyncCapabilities {
  supported: boolean;
  reason?: string;
  modes?: string[];
  presets?: string[];
  protocols?: string[];
  parameters?: string[];
  unsupported?: Record<string, string>;
  unsupported_values?: Record<string, Record<string, string>>;
  platform?: string;
  requirements?: Record<string, string>;
  unsupported_modes?: Record<string, string>;
}

function object(value: unknown): value is DesyncOptions {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function fail(key: string, reason: string): never {
  throw new Error(`${key}: ${reason}`);
}
function integer(key: string, value: unknown, [min, max]: [number, number]) {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  )
    fail(key, _('Expected an integer in range %s').format(`${min}–${max}`));
}
function duration(key: string, value: unknown, min = 0, max = Infinity) {
  if (
    typeof value !== 'string' ||
    !/^(?:\d+(?:\.\d+)?(?:ns|us|µs|ms|s|m|h))+$/.test(value)
  )
    fail(key, _('Expected a duration, for example 100ms or 5s'));
  const scales: Record<string, number> = {
    ns: 1e-9,
    us: 1e-6,
    µs: 1e-6,
    ms: 0.001,
    s: 1,
    m: 60,
    h: 3600,
  };
  const seconds = [
    ...value.matchAll(/(\d+(?:\.\d+)?)(ns|us|µs|ms|s|m|h)/g),
  ].reduce((total, match) => total + Number(match[1]) * scales[match[2]], 0);
  if (seconds < min || seconds > max)
    fail(key, _('Duration is outside the supported range'));
  return seconds;
}

// A small key=value grammar: quoted strings and JSON arrays/objects permit spaces.
// Duplicate/unknown tokens are errors, never silently discarded.
export function parseStrategy(text: string): DesyncOptions {
  const result: DesyncOptions = {};
  let rest = text.trim();
  while (rest) {
    const match = /^([a-z_]+)=/.exec(rest);
    if (!match) fail(_('Strategy'), _('Expected key=value'));
    const key = match[1];
    rest = rest.slice(match[0].length);
    let end = 0;
    let quoted = false;
    let escape = false;
    let depth = 0;
    for (; end < rest.length; end++) {
      const char = rest[end];
      if (escape) {
        escape = false;
        continue;
      }
      if (char === '\\' && quoted) {
        escape = true;
        continue;
      }
      if (char === '"') quoted = !quoted;
      if (!quoted) {
        if (char === '[' || char === '{') depth++;
        if (char === ']' || char === '}') depth--;
        if (/\s/.test(char) && depth === 0) break;
      }
    }
    if (quoted || depth !== 0) fail(key, _('Unterminated value'));
    const raw = rest.slice(0, end);
    if (!raw || Object.prototype.hasOwnProperty.call(result, key))
      fail(key, _('Empty or duplicate parameter'));
    if (!DESYNC_KEYS.includes(key) || key === 'strategy')
      fail(key, _('Unknown desync parameter'));
    if (
      raw.startsWith('"') ||
      raw.startsWith('[') ||
      raw.startsWith('{') ||
      BOOLEAN_KEYS.has(key) ||
      key in NUMBER_LIMITS
    ) {
      try {
        result[key] = JSON.parse(raw);
      } catch {
        fail(key, _('Invalid JSON value'));
      }
    } else result[key] = raw;
    if (key === 'fake_sni_pool' && typeof result[key] === 'string')
      result[key] = String(result[key]).split(',');
    rest = rest.slice(end).trimStart();
  }
  return result;
}

export function importDesync(text: string): DesyncOptions {
  const trimmed = text.trim();
  if (!trimmed) return { preset: 'auto' };
  const value: unknown =
    trimmed.startsWith('{') || trimmed.startsWith('[')
      ? JSON.parse(trimmed)
      : parseStrategy(trimmed);
  if (!object(value)) fail(_('Strategy'), _('Expected a JSON object'));
  // Import strings are expanded first; explicit JSON fields win, including false and zero.
  const { strategy, ...explicit } = value;
  if (strategy !== undefined && typeof strategy !== 'string')
    fail('strategy', _('Expected a string'));
  return { ...(strategy ? parseStrategy(strategy) : {}), ...explicit };
}
export function loadDesync(options: string, strategy = ''): DesyncOptions {
  return {
    ...(strategy.trim() ? parseStrategy(strategy) : {}),
    ...importDesync(options || '{}'),
  };
}
export function exportDesync(options: DesyncOptions): string {
  return Object.entries(options)
    .map(
      ([key, value]) =>
        `${key}=${typeof value === 'string' && !/\s|["\\{}[\]]/.test(value) && value !== '' ? value : JSON.stringify(value)}`,
    )
    .join(' ');
}
export function customDesync(options: DesyncOptions): DesyncOptions {
  const canonical = importDesync(JSON.stringify(options));
  delete canonical.adaptive;
  const preset = String(canonical.preset || '');
  let defaults: DesyncOptions = {};
  if (
    [
      'auto',
      'split',
      'disorder',
      'tlsrec',
      'fake',
      'fake_split',
      'oob',
    ].includes(preset)
  )
    defaults = { mode: preset === 'auto' ? 'split' : preset };
  else if (/^GT[1-4]$/.test(preset))
    defaults = {
      mode: 'none',
      udp_mode: 'auto',
      udp_repeats: Number(preset[2]),
      udp_out_range: `1:${preset[2]}`,
    };
  return { ...defaults, ...canonical, preset: 'custom', auto_tune: false };
}

export function validateDesync(
  options: DesyncOptions,
  capabilities?: DesyncCapabilities,
): true | string {
  try {
    if (capabilities && !capabilities.supported)
      throw new Error(
        capabilities.reason || _('The installed core does not support Desync'),
      );
    if (JSON.stringify(options).length > 32768)
      throw new Error(_('Strategy exceeds 32 KiB'));
    for (const [key, value] of Object.entries(options)) {
      if (!DESYNC_KEYS.includes(key)) fail(key, _('Unknown desync parameter'));
      if (capabilities?.unsupported?.[key])
        fail(key, capabilities.unsupported[key]);
      const unsupportedValue =
        capabilities?.unsupported_values?.[key]?.[String(value)];
      if (unsupportedValue) fail(key, unsupportedValue);
      if (capabilities?.parameters && !capabilities.parameters.includes(key))
        fail(key, _('Unsupported by the installed core'));
      if (BOOLEAN_KEYS.has(key)) {
        if (typeof value !== 'boolean') fail(key, _('Expected true or false'));
      } else if (key in NUMBER_LIMITS) integer(key, value, NUMBER_LIMITS[key]);
      else if (key === 'fake_sni_pool') {
        if (
          !Array.isArray(value) ||
          value.length > 64 ||
          value.some((v) => typeof v !== 'string' || !v.trim())
        )
          fail(key, _('Expected an array of host names'));
      } else if (key === 'adaptive') {
        if (!object(value)) fail(key, _('Expected a JSON object'));
        for (const [name, entry] of Object.entries(value)) {
          if (name in ADAPTIVE_LIMITS)
            integer(`adaptive.${name}`, entry, ADAPTIVE_LIMITS[name]);
          else if (['ttl', 'timeout'].includes(name))
            duration(
              `adaptive.${name}`,
              entry,
              name === 'ttl' ? 60 : 1,
              name === 'ttl' ? 604800 : 60,
            );
          else if (
            name !== 'network_id' ||
            typeof entry !== 'string' ||
            entry.length > 256 ||
            /[\r\n\0]/.test(entry)
          )
            fail(
              `adaptive.${name}`,
              _('Unknown or invalid Adaptive parameter'),
            );
        }
      } else if (typeof value !== 'string') fail(key, _('Expected a string'));
    }
    const choice = (key: string, choices: string[]) => {
      if (options[key] !== undefined && !choices.includes(String(options[key])))
        fail(key, _('Unsupported value'));
    };
    choice('preset', capabilities?.presets || DESYNC_PRESETS);
    choice('mode', capabilities?.modes || DESYNC_MODES);
    choice('udp_mode', ['none', 'auto', 'quic', 'stun']);
    choice('fooling', [
      '',
      'none',
      'badseq',
      'badack',
      'badsum',
      'md5',
      'md5_badack',
      'badseq_badack_badsum',
      'datanoack',
      'hopbyhop',
      'destopt',
      'ipfrag',
      'ts',
      'badtimestamp',
    ]);
    if (options.delay !== undefined && options.delay !== '0')
      duration('delay', options.delay, 0, 1);
    for (const [key, value] of Object.entries(options)) {
      if (typeof value === 'string' && /[\r\n\0]/.test(value))
        fail(key, _('Expected a single-line string'));
    }
    for (const key of ['fake_sni', 'fake_host']) {
      const value = options[key];
      if (
        typeof value === 'string' &&
        (value.length > 253 || /[ \t]/.test(value))
      )
        fail(key, _('Invalid host name'));
    }
    if (
      Array.isArray(options.fake_sni_pool) &&
      options.fake_sni_pool.some(
        (value) =>
          typeof value !== 'string' ||
          value.length > 253 ||
          /[^A-Za-z0-9._-]/.test(value),
      )
    )
      fail('fake_sni_pool', _('Invalid host name'));
    if (
      options.adaptive &&
      (options.auto_tune === false ||
        (options.auto_tune !== true && options.preset !== 'auto'))
    )
      fail('adaptive', _('Adaptive requires auto_tune=true or preset=auto'));
    if (
      typeof options.split_pos === 'string' &&
      options.split_pos.split(',').length > 16
    )
      fail('split_pos', _('At most 16 split positions'));
    if (
      options.split_pos !== undefined &&
      !String(options.split_pos)
        .split(',')
        .every((p) =>
          /^(?:[1-9]\d*|(?:sni|sniext|host|midsld|endhost|extlen)(?:[+-]\d+)?)$/.test(
            p.trim(),
          ),
        )
    )
      fail('split_pos', _('Invalid split position'));
    if (options.udp_out_range !== undefined) {
      const range = /^(\d+):(\d+)$/.exec(String(options.udp_out_range));
      if (!range || +range[1] < 1 || +range[2] < +range[1] || +range[2] > 1024)
        fail(
          'udp_out_range',
          _('Expected an inclusive packet range, for example 1:3'),
        );
    }
    for (const key of ['fake_payload', 'udp_fake_payload', 'syndata']) {
      const value = options[key];
      if (
        value !== undefined &&
        (typeof value !== 'string' ||
          value.length > 87384 ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
            value,
          ))
      )
        fail(key, _('Expected a base64 payload'));
    }
    const mode = String(
      options.mode ||
        (String(options.preset || '').startsWith('GT')
          ? 'none'
          : DESYNC_MODES.includes(String(options.preset))
            ? options.preset
            : 'split'),
    );
    const udpMode = String(
      options.udp_mode ||
        (String(options.preset || '').startsWith('GT') ? 'auto' : 'none'),
    );
    const enabled = (key: string) =>
      options[key] !== undefined &&
      options[key] !== false &&
      options[key] !== 0 &&
      options[key] !== '' &&
      (!Array.isArray(options[key]) || options[key].length > 0);
    const fakeMode = [
      'fake',
      'fake_split',
      'fake_disorder',
      'hostfakesplit',
      'oob',
      'disoob',
    ].includes(mode);
    const quicEnabled = udpMode === 'quic' || udpMode === 'auto';
    if (
      !quicEnabled &&
      (options.quic_desync !== undefined || options.quic_repeats !== undefined)
    )
      fail('udp_mode', _('QUIC parameters require UDP mode quic or auto'));
    if (
      options.quic_desync === false &&
      typeof options.quic_repeats === 'number' &&
      options.quic_repeats > 0
    )
      fail('quic_repeats', _('QUIC repetitions require quic_desync=true'));
    if (
      options.quic_desync === false &&
      udpMode === 'quic' &&
      typeof options.udplen === 'number' &&
      options.udplen > 0
    )
      fail(
        'udplen',
        _('QUIC resizing requires quic_desync=true in UDP mode quic'),
      );
    if (capabilities?.unsupported_modes?.[mode])
      fail('mode', capabilities.unsupported_modes[mode]);
    if (
      enabled('split_pos') &&
      (mode === 'none' ||
        (['fake', 'oob'].includes(mode) &&
          options.tlsrec_first !== true &&
          !['ipfrag', 'seqovl', 'wsize'].some(enabled)))
    )
      fail(
        'split_pos',
        _(
          'Split positions have no effect in this TCP mode without real-segment transformation',
        ),
      );
    if (capabilities?.platform && capabilities.platform !== 'linux') {
      if (options.udp_keep_socket === false)
        fail(
          'udp_keep_socket',
          _('Ephemeral raw UDP injection requires Linux with CAP_NET_RAW'),
        );
      if (options.wscale !== undefined || enabled('syndata'))
        fail('wscale/syndata', _('Pre-SYN parameters require Linux'));
    }
    if (!fakeMode && typeof options.repeats === 'number' && options.repeats > 1)
      fail('repeats', _('Multiple fake repetitions require a fake TCP mode'));
    if (
      mode === 'none' &&
      typeof options.delay === 'string' &&
      options.delay !== '0' &&
      duration('delay', options.delay) > 0
    )
      fail('delay', _('Delay requires an enabled TCP mode'));
    if (
      !fakeMode &&
      [
        'fake_sni',
        'fake_host',
        'fake_payload',
        'fake_sni_pool',
        'fooling',
        'ttl',
        'autottl',
      ].some(enabled)
    )
      fail('mode', _('Fake parameters require a fake TCP mode'));
    if (
      mode === 'none' &&
      ['ipfrag', 'seqovl', 'wsize', 'tlsrec_first'].some(enabled)
    )
      fail(
        'mode',
        _('TCP transformation parameters require an enabled TCP mode'),
      );
    if (
      udpMode === 'none' &&
      [
        'udp_fake_payload',
        'udp_ttl',
        'udp_repeats',
        'udp_out_range',
        'udplen',
      ].some(enabled)
    )
      fail('udp_mode', _('UDP parameters require an enabled UDP mode'));
    if (
      typeof options.ipfrag === 'number' &&
      options.ipfrag !== 0 &&
      (options.ipfrag < 8 || options.ipfrag > 65512 || options.ipfrag % 8 !== 0)
    )
      fail(
        'ipfrag',
        _('IP fragment size must be a multiple of 8 from 8 to 65512'),
      );
    if (typeof options.seqovl === 'number' && options.seqovl > 4096)
      fail('seqovl', _('Sequence overlap must not exceed 4096 bytes'));
    if (
      typeof options.udplen === 'number' &&
      options.udplen !== 0 &&
      (options.udplen > 64000 ||
        (udpMode === 'stun' &&
          (options.udplen < 4 || options.udplen % 4 !== 0)))
    )
      fail(
        'udplen',
        _(
          'UDP padding must be at most 64000 bytes; STUN requires multiples of 4',
        ),
      );
    return true;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
