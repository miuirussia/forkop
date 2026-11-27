import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../api', () => ({
  desyncApi: {
    start: vi.fn(),
    progress: vi.fn(),
    cancel: vi.fn(),
    diagnostics: vi.fn(),
    clear: vi.fn(),
    capabilities: vi.fn(),
  },
}));
import { desyncApi } from '../api';
import { renderDesyncEditor, validateDesyncEditor } from '../widget';
import { addDesyncOptions } from '../form';
import { bindInlineValidation } from '../../../../cbi/validation';

class NodeStub {
  children: Array<NodeStub | string> = [];
  value = '';
  textContent = '';
  disabled = false;
  hidden = false;
  isConnected = true;
  validity = { badInput: false };
  listeners = new Map<string, Array<() => void>>();
  constructor(
    readonly tag: string,
    readonly attrs: Record<string, unknown> = {},
    children: unknown = [],
  ) {
    this.value = String(attrs.value || '');
    // LuCI serializes every non-null attribute, including disabled=false.
    this.disabled = attrs.disabled != null;
    this.append(...(Array.isArray(children) ? children : [children]));
    if (tag === 'select')
      this.value =
        (
          this.children.find(
            (child) => child instanceof NodeStub && !child.disabled,
          ) as NodeStub
        )?.value || '';
  }
  append(...children: unknown[]) {
    this.children.push(...(children as Array<NodeStub | string>));
    this.textContent = this.children
      .filter((child) => typeof child === 'string')
      .join('');
  }
  replaceChildren(...children: unknown[]) {
    this.children = [];
    this.append(...children);
  }
  setAttribute(key: string, value: unknown) {
    this.attrs[key] = value;
  }
  addEventListener(key: string, listener: () => void) {
    this.listeners.set(key, [...(this.listeners.get(key) || []), listener]);
  }
  dispatchEvent(event: Event) {
    for (const listener of this.listeners.get(event.type) || []) listener();
    return true;
  }
  click() {
    if (!this.disabled)
      (this.attrs.click as ((event: Event) => void) | undefined)?.(
        new Event('click', { cancelable: true }),
      );
  }
  change(value: string) {
    this.value = value;
    this.dispatchEvent(new Event('change'));
  }
  focus() {}
  select() {}
  checkValidity() {
    return true;
  }
  reportValidity() {
    return true;
  }
}
function nodes(root: NodeStub): NodeStub[] {
  return [
    root,
    ...root.children.flatMap((child) =>
      typeof child === 'string' ? [] : nodes(child),
    ),
  ];
}
function button(root: NodeStub, label: string) {
  const found = nodes(root).find(
    (node) => node.tag === 'button' && node.textContent === label,
  );
  if (!found) throw new Error(label);
  return found;
}
function tab(root: NodeStub, label: string) {
  const found = nodes(root).find(
    (node) => node.attrs.role === 'tab' && node.textContent === label,
  );
  if (!found) throw new Error(label);
  return found;
}
function pane(root: NodeStub, label: string) {
  const id = tab(root, label).attrs['aria-controls'];
  return nodes(root).find((node) => node.attrs.id === id)!;
}
function control(root: NodeStub, label: string) {
  const found = nodes(root).find((node) => node.attrs['aria-label'] === label);
  if (!found) throw new Error(label);
  return found;
}
function field(root: NodeStub, label: string) {
  const row = nodes(root).find(
    (node) =>
      node.tag === 'label' &&
      (node.children[0] as NodeStub)?.textContent === label,
  );
  return row?.children[1] as NodeStub;
}
function editor(protocols = ['tls', 'http', 'quic']) {
  const source = new NodeStub('textarea', {
    value:
      '{"preset":"auto","auto_tune":true,"adaptive":{"max_attempts":2},"seqovl":0}',
  });
  const root = renderDesyncEditor(
    source as unknown as Node,
    source as unknown as HTMLTextAreaElement,
    's1',
    { supported: true, protocols },
  ) as unknown as NodeStub;
  return { root, source };
}
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal(
    'E',
    (tag: string, attrs: Record<string, unknown>, children: unknown) =>
      new NodeStub(tag, attrs, children),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('Desync editor and tuner', () => {
  it.each([
    {
      protocols: ['tls', 'http', 'quic'],
      disabled: [false, false, false],
      selected: 'tls',
    },
    {
      protocols: ['tls', 'http'],
      disabled: [false, false, true],
      selected: 'tls',
    },
    { protocols: ['http'], disabled: [true, false, true], selected: 'http' },
  ])(
    'keeps advertised protocols selectable with LuCI boolean attributes: $protocols',
    ({ protocols, disabled, selected }) => {
      const { root } = editor(protocols);
      const protocol = field(root, 'Protocol');
      expect(
        protocol.children.map((child) => (child as NodeStub).disabled),
      ).toEqual(disabled);
      expect(protocol.value).toBe(selected);
    },
  );
  it('keeps editor and tool errors visible after modal validation', async () => {
    const { root } = editor();
    const alerts = nodes(root).filter((node) => node.attrs.role === 'alert');
    alerts.forEach((alert) => {
      Object.assign(alert, {
        remove: () => root.children.splice(root.children.indexOf(alert), 1),
      });
    });
    // The LuCI field is valid, so its inline validator removes only alerts it owns.
    const luciField = {
      querySelector: (selector: string) =>
        selector === '.fkp-field-error'
          ? nodes(root).find((node) =>
              String(node.attrs.class || '')
                .split(' ')
                .includes('fkp-field-error'),
            )
          : null,
      querySelectorAll: () => [],
    };
    const modal = Object.assign(new EventTarget(), {
      querySelectorAll: () => [luciField],
      contains: (node: unknown) => node === luciField,
    });
    bindInlineValidation(
      modal as unknown as HTMLElement,
      { checkDepends: vi.fn() } as unknown as CBIMap,
    );
    expect(alerts.every((alert) => nodes(root).includes(alert))).toBe(true);

    control(root, 'Strategy import or export').value = '{';
    button(root, 'Import strategy').click();
    expect(alerts[0].textContent).not.toBe('');
    vi.mocked(desyncApi.diagnostics).mockRejectedValue(new Error('Offline'));
    button(root, 'Refresh diagnostics').click();
    await settle();
    expect(alerts[1].textContent).toBe('Offline');

    const event = new Event('validation-success');
    Object.defineProperty(event, 'target', {
      value: { closest: () => luciField },
    });
    modal.dispatchEvent(event);
    expect(alerts.every((alert) => nodes(root).includes(alert))).toBe(true);
    expect(alerts[0].textContent).not.toBe('');
    expect(alerts[1].textContent).toBe('Offline');
  });
  it('preserves form edits across tabs and supports keyboard tab selection', () => {
    const { root, source } = editor();
    expect(pane(root, 'Parameters').hidden).toBe(false);
    expect(pane(root, 'Diagnostics').hidden).toBe(true);
    expect(pane(root, 'Strategy testing').hidden).toBe(true);
    control(root, 'TCP mode').change('multi_split');
    const saved = source.value;
    tab(root, 'Diagnostics').click();
    expect(pane(root, 'Parameters').hidden).toBe(true);
    expect(pane(root, 'Diagnostics').hidden).toBe(false);
    expect(tab(root, 'Diagnostics').attrs['aria-selected']).toBe('true');
    expect(tab(root, 'Parameters').attrs.tabindex).toBe('-1');
    const keydown = tab(root, 'Diagnostics').attrs.keydown as (
      event: KeyboardEvent,
    ) => void;
    keydown({ key: 'End', preventDefault() {} } as KeyboardEvent);
    expect(pane(root, 'Strategy testing').hidden).toBe(false);
    expect(tab(root, 'Strategy testing').attrs.tabindex).toBe('0');
    tab(root, 'Parameters').click();
    expect(control(root, 'TCP mode').value).toBe('multi_split');
    expect(source.value).toBe(saved);
  });
  it('refreshes diagnostics in its tab without changing the strategy', async () => {
    const { root, source } = editor();
    const saved = source.value;
    vi.mocked(desyncApi.diagnostics).mockResolvedValue({ outbounds: {} });
    tab(root, 'Diagnostics').click();
    button(root, 'Refresh diagnostics').click();
    await settle();
    expect(desyncApi.diagnostics).toHaveBeenCalledWith('s1');
    expect(
      nodes(pane(root, 'Diagnostics')).some((node) =>
        node.textContent.includes('No active Desync outbound'),
      ),
    ).toBe(true);
    expect(source.value).toBe(saved);
  });
  it('edits advanced QUIC controls without losing false and zero, or declaring pre-SYN unsupported', () => {
    const { root, source } = editor();
    control(root, 'UDP mode').change('auto');
    control(root, 'Enable QUIC desync').change('false');
    control(root, 'QUIC fake repetitions (0 inherits UDP repetitions)').change(
      '0',
    );
    control(root, 'Keep UDP socket').change('false');
    control(root, 'TCP window scale').change('0');
    control(root, 'SYN data (base64)').change('YWJjZA==');
    expect(JSON.parse(source.value)).toMatchObject({
      udp_mode: 'auto',
      quic_desync: false,
      quic_repeats: 0,
      udp_keep_socket: false,
      wscale: 0,
      syndata: 'YWJjZA==',
    });
    expect(
      nodes(root)
        .filter((node) => node.attrs.role === 'alert')
        .every((node) => !node.textContent),
    ).toBe(true);
    button(root, 'Export string').click();
    expect(control(root, 'Strategy import or export').value).toContain(
      'quic_desync=false',
    );
    expect(control(root, 'Strategy import or export').value).toContain(
      'quic_repeats=0',
    );
    control(root, 'QUIC fake repetitions (0 inherits UDP repetitions)').change(
      '',
    );
    expect(JSON.parse(source.value)).not.toHaveProperty('quic_repeats');
    button(root, 'Import strategy').click();
    expect(JSON.parse(source.value)).toMatchObject({
      quic_desync: false,
      quic_repeats: 0,
    });
  });
  it('uses game UDP profiles as default QUIC tuner candidates', async () => {
    const { root } = editor();
    vi.mocked(desyncApi.start).mockResolvedValue({
      id: '1-2-3',
      state: 'completed',
      results: [],
    });
    field(root, 'Test target').value = 'example.org:443';
    field(root, 'Protocol').value = 'quic';
    button(root, 'Find a strategy').click();
    await settle();
    expect(desyncApi.start).toHaveBeenCalledWith(
      expect.objectContaining({
        protocol: 'quic',
        candidates: ['GT1', 'GT2', 'GT3', 'GT4'].map((preset) => ({
          preset,
          auto_tune: false,
        })),
      }),
    );
  });
  it('keeps advanced options while manual controls update the canonical source', () => {
    const { root, source } = editor();
    expect(
      nodes(root).filter((node) => node.attrs['aria-label'] === 'Fake SNI'),
    ).toHaveLength(1);
    control(root, 'TCP mode').change('multi_split');
    expect(JSON.parse(source.value)).toMatchObject({
      mode: 'multi_split',
      seqovl: 0,
      adaptive: { max_attempts: 2 },
    });
    control(root, 'Strategy profile').change('custom');
    expect(JSON.parse(source.value)).toMatchObject({
      preset: 'custom',
      auto_tune: false,
    });
    expect(JSON.parse(source.value)).not.toHaveProperty('adaptive');
  });
  it('runs isolated probes, polls progress, and changes the form only on explicit Apply', async () => {
    const { root, source } = editor();
    tab(root, 'Strategy testing').click();
    const before = source.value;
    vi.mocked(desyncApi.start).mockResolvedValue({
      id: '1-2-3',
      state: 'running',
      results: [],
      completed: 0,
      total: 2,
    });
    vi.mocked(desyncApi.progress).mockResolvedValue({
      id: '1-2-3',
      state: 'completed',
      completed: 2,
      total: 2,
      results: [
        {
          options: { preset: 'split' },
          success: true,
          protocol: 'tls',
          latency_ms: 12,
        },
        { options: { preset: 'split' }, success: false, protocol: 'tls' },
      ],
    });
    field(root, 'Test target').value = 'example.org:443';
    button(root, 'Find a strategy').click();
    await settle();
    expect(desyncApi.start).toHaveBeenCalledWith(
      expect.objectContaining({
        section: 's1',
        protocol: 'tls',
        candidates: [
          { preset: 'split', auto_tune: false },
          { preset: 'tlsrec', auto_tune: false },
          { preset: 'fake_split', auto_tune: false },
        ],
      }),
    );
    expect(source.value).toBe(before);
    tab(root, 'Parameters').click();
    await vi.advanceTimersByTimeAsync(1000);
    expect(desyncApi.cancel).not.toHaveBeenCalled();
    tab(root, 'Strategy testing').click();
    expect(desyncApi.progress).toHaveBeenCalledWith('1-2-3');
    expect(source.value).toBe(before);
    expect(nodes(root).some((node) => node.textContent === '50%')).toBe(true);
    control(root, 'Adaptive limits (JSON object)').change('{');
    button(root, 'Apply as custom').click();
    await settle();
    expect(validateDesyncEditor(source as unknown as Node)).toBe(true);
    expect(control(root, 'Adaptive limits (JSON object)').value).toBe('');
    expect(JSON.parse(source.value)).toEqual({
      preset: 'custom',
      mode: 'split',
      auto_tune: false,
    });
  });
  it('continues polling when cancellation is acknowledged before the worker stops', async () => {
    const { root } = editor();
    const running = { id: '1-2-3', state: 'running' as const, results: [] };
    vi.mocked(desyncApi.start).mockResolvedValue(running);
    vi.mocked(desyncApi.cancel).mockResolvedValue(running);
    vi.mocked(desyncApi.progress).mockResolvedValue({
      ...running,
      state: 'cancelled',
    });
    field(root, 'Test target').value = 'example.org:443';
    button(root, 'Find a strategy').click();
    await settle();
    button(root, 'Cancel tests').click();
    await settle();
    expect(desyncApi.cancel).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(desyncApi.progress).toHaveBeenCalledWith('1-2-3');
    expect(button(root, 'Find a strategy').disabled).toBe(false);
  });
  it('keeps one polling loop after a failed cancellation request', async () => {
    const { root } = editor();
    const running = { id: '1-2-3', state: 'running' as const, results: [] };
    vi.mocked(desyncApi.start).mockResolvedValue(running);
    vi.mocked(desyncApi.progress).mockResolvedValue(running);
    vi.mocked(desyncApi.cancel).mockRejectedValue(new Error('Offline'));
    field(root, 'Test target').value = 'example.org:443';
    button(root, 'Find a strategy').click();
    await settle();
    button(root, 'Cancel tests').click();
    await settle();
    await vi.advanceTimersByTimeAsync(1500);
    expect(desyncApi.progress).toHaveBeenCalledTimes(1);
  });
  it('does not replace a new job with an older in-flight progress reply', async () => {
    const { root } = editor();
    const first = { id: '1-2-3', state: 'running' as const, results: [] };
    const second = { id: '4-5-6', state: 'running' as const, results: [] };
    let resolveOld!: (job: typeof first) => void;
    const oldProgress = new Promise<typeof first>((resolve) => {
      resolveOld = resolve;
    });
    vi.mocked(desyncApi.start)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    vi.mocked(desyncApi.progress)
      .mockImplementationOnce(() => oldProgress)
      .mockResolvedValue({ ...second, state: 'completed' });
    vi.mocked(desyncApi.cancel).mockResolvedValue({
      ...first,
      state: 'cancelled',
    });
    field(root, 'Test target').value = 'example.org:443';
    button(root, 'Find a strategy').click();
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    button(root, 'Cancel tests').click();
    await settle();
    button(root, 'Find a strategy').click();
    await settle();
    resolveOld(first);
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    expect(desyncApi.progress).toHaveBeenLastCalledWith(second.id);
  });
  it('does not replace the strategy on an invalid import', () => {
    const { root, source } = editor();
    const before = source.value;
    control(root, 'Strategy import or export').value = '{"mode":"unsupported"}';
    button(root, 'Import strategy').click();
    expect(source.value).toBe(before);
    expect(
      nodes(root).some(
        (node) =>
          node.attrs.role === 'alert' && node.textContent.includes('mode'),
      ),
    ).toBe(true);
  });
  it('refuses malformed JSON drafts in LuCI validation and writes until they are repaired', async () => {
    const source = Object.assign(new NodeStub('textarea'), {
      tagName: 'TEXTAREA',
    });
    const writes = vi.fn();
    vi.stubGlobal('uci', { get: vi.fn(), set: writes, unset: vi.fn() });
    vi.mocked(desyncApi.capabilities).mockResolvedValue({ supported: true });
    const option = {
      renderWidget: () => source,
      depends: vi.fn(),
      getUIElement: () => ({ node: source }),
    } as unknown as CBIOption;
    addDesyncOptions({ taboption: () => option } as unknown as CBISection);
    source.value = String(await option.load('s1'));
    const root = (await option.renderWidget(
      's1',
      '0',
      source.value,
    )) as unknown as NodeStub;
    const adaptive = control(root, 'Adaptive limits (JSON object)');
    adaptive.change('{"max_attempts":');
    expect(option.validate('s1', source.value)).toContain('adaptive:');
    expect(() => option.write('s1', source.value)).toThrow('adaptive:');
    expect(writes).not.toHaveBeenCalled();
    control(root, 'TCP mode').change('multi_split');
    expect(adaptive.value).toBe('{"max_attempts":');
    expect(adaptive.attrs['aria-invalid']).toBe('true');
    expect(option.validate('s1', source.value)).toContain('adaptive:');
    adaptive.change('{"max_attempts":3}');
    expect(option.validate('s1', source.value)).toBe(true);
    option.write('s1', source.value);
    expect(writes).toHaveBeenCalledWith(
      'forkop',
      's1',
      'desync_options',
      expect.stringContaining('"max_attempts":3'),
    );
  });
  it('keeps malformed numeric input distinct from an intentionally empty override', () => {
    const { root, source } = editor();
    control(root, 'TCP mode').change('fake');
    const ttl = control(root, 'Fake packet TTL');
    ttl.change('64');
    ttl.validity.badInput = true;
    ttl.value = '';
    ttl.dispatchEvent(new Event('input'));
    expect(JSON.parse(source.value).ttl).toBe(64);
    expect(validateDesyncEditor(source as unknown as Node)).toContain('ttl:');
    control(root, 'Delay (for example 100ms)').change('100ms');
    expect(ttl.value).toBe('');
    expect(ttl.attrs['aria-invalid']).toBe('true');
    ttl.validity.badInput = false;
    ttl.change('65');
    expect(validateDesyncEditor(source as unknown as Node)).toBe(true);
    expect(JSON.parse(source.value).ttl).toBe(65);
    ttl.change('');
    expect(JSON.parse(source.value)).not.toHaveProperty('ttl');
  });
  it('blocks exports of stale values and resets drafts on explicit strategy replacement', () => {
    const { root, source } = editor();
    const adaptive = control(root, 'Adaptive limits (JSON object)');
    adaptive.value = '{';
    adaptive.dispatchEvent(new Event('input'));
    button(root, 'Export JSON').click();
    expect(control(root, 'Strategy import or export').value).toBe('');
    control(root, 'Strategy import or export').value =
      '{"preset":"custom","mode":"split","auto_tune":false}';
    button(root, 'Import strategy').click();
    expect(validateDesyncEditor(source as unknown as Node)).toBe(true);
    expect(adaptive.value).toBe('');
    adaptive.change('{');
    source.value = '{"preset":"auto","adaptive":{"max_attempts":4}}';
    source.dispatchEvent(new Event('input'));
    expect(validateDesyncEditor(source as unknown as Node)).toBe(true);
    expect(adaptive.value).toBe('{"max_attempts":4}');
    expect(adaptive.attrs['aria-invalid']).toBe('false');
  });
  it('marks an invalid setting and clears its error after correction', () => {
    const { root } = editor();
    control(root, 'TCP mode').change('fake');
    const ttl = control(root, 'Fake packet TTL');
    ttl.change('0');
    expect(ttl.attrs['aria-invalid']).toBe('true');
    const alert = nodes(root).find(
      (node) => node.attrs.role === 'alert' && node.textContent,
    )!;
    expect(alert.attrs.class).toContain('fkp-desync__error');
    expect(alert.textContent).toContain('ttl:');
    expect(ttl.attrs['aria-describedby']).toBe(alert.attrs.id);
    ttl.change('64');
    expect(ttl.attrs['aria-invalid']).toBe('false');
    expect(alert.textContent).toBe('');
  });
  it('highlights failed jobs and failed protocol results', async () => {
    const { root } = editor();
    vi.mocked(desyncApi.start).mockResolvedValue({
      id: '1-2-3',
      state: 'failed',
      error: 'Connection timed out',
      results: [
        {
          options: { preset: 'split' },
          success: false,
          protocol: 'tls',
          error: 'TLS handshake failed',
        },
      ],
    });
    field(root, 'Test target').value = 'example.org:443';
    button(root, 'Find a strategy').click();
    await settle();
    const status = nodes(root).find((node) => node.attrs.role === 'status')!;
    expect(status.attrs.class).toBe('fkp-desync__failure');
    expect(status.textContent).toContain('Connection timed out');
    const failures = nodes(root).filter(
      (node) => node.tag === 'td' && node.attrs.class === 'fkp-desync__failure',
    );
    expect(failures.map((node) => node.textContent)).toEqual([
      'TLS handshake failed',
      'Failed',
    ]);
    expect(button(root, 'Apply as custom').disabled).toBe(true);
  });
  it('closes a running tuner when the dialog is detached', async () => {
    const { root } = editor();
    vi.mocked(desyncApi.start).mockResolvedValue({
      id: '1-2-3',
      state: 'running',
      results: [],
    });
    vi.mocked(desyncApi.cancel).mockResolvedValue({
      id: '1-2-3',
      state: 'cancelled',
      results: [],
    });
    field(root, 'Test target').value = 'example.org:443';
    button(root, 'Find a strategy').click();
    await settle();
    const toolRoot = nodes(root).find(
      (node) => node.attrs.class === 'fkp-desync__tools',
    )!;
    toolRoot.isConnected = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(desyncApi.cancel).toHaveBeenCalledWith('1-2-3');
    expect(desyncApi.progress).not.toHaveBeenCalled();
  });
});
