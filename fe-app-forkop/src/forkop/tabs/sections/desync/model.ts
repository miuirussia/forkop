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
  'tlsrec_pos',
  'segment_order',
  'fake_placement',
  'fake_delay',
  'fake_tls_random',
  'fake_tls_size',
  'fake_tls_template',
  'http_mod',
  'hostfake_mode',
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
  'quic_split_pos',
  'quic_order',
  'udplen',
  'auto_tune',
  'adaptive',
  'strategy',
];
const BOOLEAN_KEYS = new Set([
  'fake_tls_random',
  'tlsrec_first',
  'autottl',
  'udp_keep_socket',
  'quic_desync',
  'auto_tune',
]);
const NUMBER_LIMITS: Record<string, [number, number]> = {
  fake_tls_size: [0, 60000],
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
function integer(
  key: string,
  value: unknown,
  [min, max]: [number, number],
  incomplete = false,
) {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    (!incomplete && (value < min || value > max))
  )
    fail(key, _('Expected an integer in range %s').format(`${min}–${max}`));
}
function duration(key: string, value: unknown, min = 0, max = Infinity) {
  if (
    typeof value !== 'string' ||
    !/^[+-]?(?:0|(?:(?:\d+(?:\.\d*)?|\.\d+)(?:ns|us|µs|μs|ms|s|m|h|d))+)$/.test(
      value,
    )
  )
    fail(key, _('Expected a duration, for example 100ms or 5s'));
  const scales: Record<string, number> = {
    ns: 1,
    us: 1000,
    µs: 1000,
    μs: 1000,
    ms: 1000000,
    s: 1000000000,
    m: 60000000000,
    h: 3600000000000,
    d: 86400000000000,
  };
  const nanoseconds = [
    ...value.matchAll(/(\d+(?:\.\d*)?|\.\d+)(ns|us|µs|μs|ms|s|m|h|d)/g),
  ].reduce((total, match) => {
    const [whole, fraction = ''] = match[1].split('.');
    const scale = scales[match[2]];
    // Go truncates each component below one nanosecond before summing.
    let remainder = 0;
    for (let i = fraction.length - 1; i >= 0; i--)
      remainder = Math.trunc((remainder + Number(fraction[i]) * scale) / 10);
    return total + Number(whole) * scale + remainder;
  }, 0);
  if (
    !Number.isFinite(nanoseconds) ||
    nanoseconds > Number('9223372036854775807')
  )
    fail(key, _('Duration is outside the supported range'));
  const seconds =
    (value.startsWith('-') ? -nanoseconds : nanoseconds) / 1000000000;
  if (seconds < min || seconds > max)
    fail(key, _('Duration is outside the supported range'));
  return seconds;
}

// Parsing checks types before merging; only effective values must meet semantic bounds.
function validateFields(options: DesyncOptions, incomplete = false) {
  for (const [key, value] of Object.entries(options)) {
    if (!DESYNC_KEYS.includes(key)) fail(key, _('Unknown desync parameter'));
    if (BOOLEAN_KEYS.has(key)) {
      if (typeof value !== 'boolean') fail(key, _('Expected true or false'));
    } else if (key in NUMBER_LIMITS)
      integer(key, value, NUMBER_LIMITS[key], incomplete);
    else if (key === 'fake_sni_pool') {
      if (
        !Array.isArray(value) ||
        (!incomplete && value.length > 64) ||
        value.some((v) => typeof v !== 'string' || (!incomplete && !v.trim()))
      )
        fail(key, _('Expected an array of host names'));
    } else if (key === 'adaptive') {
      if (!object(value)) fail(key, _('Expected a JSON object'));
      for (const [name, entry] of Object.entries(value)) {
        if (name in ADAPTIVE_LIMITS)
          integer(`adaptive.${name}`, entry, ADAPTIVE_LIMITS[name], incomplete);
        else if (['ttl', 'timeout'].includes(name))
          duration(
            `adaptive.${name}`,
            entry,
            incomplete ? -Infinity : name === 'ttl' ? 60 : 1,
            incomplete ? Infinity : name === 'ttl' ? 604800 : 60,
          );
        else if (
          name !== 'network_id' ||
          typeof entry !== 'string' ||
          (!incomplete && entry.length > 256) ||
          /[\r\n\0]/.test(entry)
        )
          fail(`adaptive.${name}`, _('Unknown or invalid Adaptive parameter'));
      }
    } else {
      if (typeof value !== 'string') fail(key, _('Expected a string'));
      if (/[\r\n\0]/.test(value)) fail(key, _('Expected a single-line string'));
      if (incomplete && ['delay', 'fake_delay'].includes(key))
        duration(key, value, -Infinity);
    }
  }
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
    if (
      typeof result[key] === 'string' &&
      (BOOLEAN_KEYS.has(key) || key in NUMBER_LIMITS)
    ) {
      try {
        result[key] = JSON.parse(String(result[key]));
      } catch {
        fail(key, _('Invalid JSON value'));
      }
    }
    if (key === 'fake_sni_pool' && typeof result[key] === 'string')
      result[key] = String(result[key]).split(',');
    rest = rest.slice(end).trimStart();
  }
  validateFields(result, true);
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
  if (strategy !== undefined) validateFields(value, true);
  return { ...(strategy ? parseStrategy(strategy) : {}), ...explicit };
}
export function loadDesync(options: string): DesyncOptions {
  return importDesync(options || '{}');
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
    validateFields(options);
    for (const key of Object.keys(options)) {
      if (capabilities?.unsupported?.[key])
        fail(key, capabilities.unsupported[key]);
      if (capabilities?.parameters && !capabilities.parameters.includes(key))
        fail(key, _('Unsupported by the installed core'));
    }
    const choice = (key: string, choices: string[]) => {
      if (options[key] !== undefined && !choices.includes(String(options[key])))
        fail(key, _('Unsupported value'));
    };
    choice('preset', ['', ...(capabilities?.presets || DESYNC_PRESETS)]);
    choice('mode', capabilities?.modes || DESYNC_MODES);
    choice('udp_mode', ['none', 'auto', 'quic', 'stun']);
    choice('fake_placement', ['', 'before', 'between', 'before_between']);
    choice('fake_tls_template', ['', 'original', 'compact']);
    choice('hostfake_mode', ['', 'legacy', 'replace']);
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
    const fakeDelay =
      options.fake_delay === undefined || options.fake_delay === '0'
        ? 0
        : duration('fake_delay', options.fake_delay, 0, 1);
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
      options.split_pos !== '' &&
      !String(options.split_pos)
        .split(',')
        .every((p) =>
          /^(?:[1-9]\d*|(?:sni|sniext|host|midsld|endhost|extlen)(?:[+-]\d+)?)$/.test(
            p.trim(),
          ),
        )
    )
      fail('split_pos', _('Invalid split position'));
    for (const key of ['tlsrec_pos', 'quic_split_pos']) {
      const value = options[key];
      if (
        typeof value === 'string' &&
        value !== '' &&
        (value.length > 1024 ||
          value.split(',').length > 16 ||
          !value
            .split(',')
            .every((p) =>
              /^(?:[1-9]\d*|(?:sni|sniext|host|midsld|endhost|extlen)(?:[+-]\d+)?)$/.test(
                p,
              ),
            ))
      )
        fail(key, _('Invalid split position'));
    }
    for (const key of ['segment_order', 'quic_order']) {
      const value = options[key];
      if (
        typeof value !== 'string' ||
        ['', 'forward', 'reverse', 'sni_last'].includes(value)
      )
        continue;
      const parts = value.split(',');
      const numbers = parts.map(Number);
      if (
        parts.length > 17 ||
        parts.some((p) => !/^\+?\d+$/.test(p)) ||
        numbers.some((n) => n < 1 || n > parts.length) ||
        new Set(numbers).size !== parts.length
      )
        fail(
          key,
          _(
            'Expected forward, reverse, sni_last or a permutation such as 2,1,3',
          ),
        );
    }
    if (options.http_mod) {
      const mods = String(options.http_mod).split(',');
      if (
        mods.some((mod) => !['hcsmix', 'dcsmix', 'rmspace'].includes(mod)) ||
        new Set(mods).size !== mods.length
      )
        fail(
          'http_mod',
          _(
            'Expected unique hcsmix, dcsmix, rmspace tokens separated by commas',
          ),
        );
    }
    if (options.udp_out_range !== undefined && options.udp_out_range !== '') {
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
      options.split_pos === '' &&
      mode !== 'none' &&
      !(['fake', 'oob'].includes(mode) && options.tlsrec_first !== true)
    )
      fail('split_pos', _('Invalid split position'));

    if (
      enabled('tlsrec_pos') &&
      mode !== 'tlsrec' &&
      options.tlsrec_first !== true
    )
      fail(
        'tlsrec_pos',
        _('TLS record positions require mode=tlsrec or tlsrec_first=true'),
      );
    const recordPositions =
      options.tlsrec_pos ||
      (mode === 'tlsrec' || options.tlsrec_first === true
        ? options.split_pos
        : '');
    if (
      String(recordPositions || '')
        .split(',')
        .some((p) => /^\+?\d+$/.test(p) && Number(p) <= 5)
    )
      fail(
        'tlsrec_pos',
        _('TLS record positions must be after the first 5 header bytes'),
      );
    if (
      enabled('segment_order') &&
      ['none', 'fake', 'oob', 'tlsrec'].includes(mode)
    )
      fail(
        'segment_order',
        _('Segment order requires a TCP segmentation mode'),
      );
    if (
      !fakeMode &&
      ([
        'fake_placement',
        'fake_tls_random',
        'fake_tls_size',
        'fake_tls_template',
      ].some(enabled) ||
        fakeDelay > 0)
    )
      fail(
        'mode',
        _(
          'Fake placement, delay and TLS transformations require a fake TCP mode',
        ),
      );
    if (
      ['between', 'before_between'].includes(String(options.fake_placement)) &&
      ['fake', 'oob'].includes(mode)
    )
      fail(
        'fake_placement',
        _('Interleaved fake placement requires a TCP segmentation mode'),
      );
    if (enabled('hostfake_mode') && mode !== 'hostfakesplit')
      fail('hostfake_mode', _('Host fake mode requires mode=hostfakesplit'));
    if (
      options.hostfake_mode === 'replace' &&
      [
        'fake_payload',
        'fake_tls_random',
        'fake_tls_size',
        'fake_tls_template',
      ].some(enabled)
    )
      fail(
        'hostfake_mode',
        _('Host replacement requires a length-preserving generated decoy'),
      );
    if (enabled('quic_split_pos') || enabled('quic_order')) {
      if (!quicEnabled)
        fail('udp_mode', _('QUIC parameters require UDP mode quic or auto'));
      if (options.quic_desync === false)
        fail(
          'quic_desync',
          _('QUIC CRYPTO transformations require quic_desync=true'),
        );
      if (enabled('quic_order') && !enabled('quic_split_pos'))
        fail('quic_order', _('QUIC order requires quic_split_pos'));
    }
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
      ([
        'fake_sni',
        'fake_host',
        'fake_payload',
        'fake_sni_pool',
        'fooling',
        'autottl',
      ].some(enabled) ||
        (enabled('ttl') && !enabled('syndata')))
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
