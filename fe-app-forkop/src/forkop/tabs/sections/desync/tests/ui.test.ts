import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../api', () => ({
  desyncApi: {
    start: vi.fn(),
    progress: vi.fn(),
    cancel: vi.fn(),
    diagnostics: vi.fn(),
    clear: vi.fn(),
  },
}));
import { desyncApi } from '../api';
import { renderDesyncEditor } from '../widget';

class NodeStub {
  children: Array<NodeStub | string> = [];
  value = '';
  textContent = '';
  disabled = false;
  isConnected = true;
  listeners = new Map<string, Array<() => void>>();
  constructor(
    readonly tag: string,
    readonly attrs: Record<string, unknown> = {},
    children: unknown = [],
  ) {
    this.value = String(attrs.value || '');
    this.disabled = Boolean(attrs.disabled);
    this.append(...(Array.isArray(children) ? children : [children]));
    if (tag === 'select')
      this.value = (this.children[0] as NodeStub)?.value || '';
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
    if (!this.disabled) (this.attrs.click as (() => void) | undefined)?.();
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
function editor() {
  const source = new NodeStub('textarea', {
    value:
      '{"preset":"auto","auto_tune":true,"adaptive":{"max_attempts":2},"seqovl":0}',
  });
  const root = renderDesyncEditor(
    source as unknown as Node,
    source as unknown as HTMLTextAreaElement,
    's1',
    { supported: true, protocols: ['tls', 'http', 'quic'] },
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
    control(root, 'Preset').change('custom');
    expect(JSON.parse(source.value)).toMatchObject({
      preset: 'custom',
      auto_tune: false,
    });
    expect(JSON.parse(source.value)).not.toHaveProperty('adaptive');
  });
  it('runs isolated probes, polls progress, and changes the form only on explicit Apply', async () => {
    const { root, source } = editor();
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
    await vi.advanceTimersByTimeAsync(1000);
    expect(desyncApi.progress).toHaveBeenCalledWith('1-2-3');
    expect(source.value).toBe(before);
    expect(nodes(root).some((node) => node.textContent === '50%')).toBe(true);
    button(root, 'Apply as custom').click();
    await settle();
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
    const toolRoot = root.children[root.children.length - 1] as NodeStub;
    toolRoot.isConnected = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(desyncApi.cancel).toHaveBeenCalledWith('1-2-3');
    expect(desyncApi.progress).not.toHaveBeenCalled();
  });
});
