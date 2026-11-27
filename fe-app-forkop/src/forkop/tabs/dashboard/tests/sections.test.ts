import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Forkop } from '../../../types';

const mocks = vi.hoisted(() => ({
  getDashboardSections: vi.fn(),
  getClashApiGroupLatency: vi.fn(),
  getClashApiProxyLatency: vi.fn(),
  updateClashApiProxyProviders: vi.fn(),
  showToast: vi.fn(),
  desyncDiagnostics: vi.fn(),
  clearDesync: vi.fn(),
}));

vi.mock('../../../services/socket.service', () => ({
  socket: { subscribe: vi.fn(), disconnect: vi.fn(), resetAll: vi.fn() },
}));
vi.mock('../../../../helpers/onMount', () => ({ onMount: async () => ({}) }));
vi.mock('../../../../helpers/showToast', () => ({
  showToast: mocks.showToast,
}));
vi.mock('../../../methods', () => ({
  CustomForkopMethods: {
    getDashboardSections: mocks.getDashboardSections,
    getClashApiConnectionsSummary: async () => ({ success: false }),
    getClashApiGroupLatency: mocks.getClashApiGroupLatency,
    getClashApiProxyLatency: mocks.getClashApiProxyLatency,
    updateClashApiProxyProviders: mocks.updateClashApiProxyProviders,
  },
}));
vi.mock('../../../methods/custom/getClashApiSecret', () => ({
  getClashApiSecret: async () => 'secret',
}));
vi.mock('../../../services/runtimeUiState.service', () => ({
  refreshRuntimeUiState: vi.fn(),
}));
vi.mock('../../sections/desync/api', () => ({
  desyncApi: { diagnostics: mocks.desyncDiagnostics, clear: mocks.clearDesync },
}));

interface FakeNode {
  type: string;
  attrs: Record<string, unknown>;
  children: Array<FakeNode | string>;
  isConnected: boolean;
  scrollTop: number;
  disabled?: boolean;
  hidden?: boolean;
  textContent?: string;
  appendChild(child: FakeNode): void;
  setAttribute(name: string, value: string): void;
  replaceChildren(...nodes: FakeNode[]): void;
  querySelector(selector: string): FakeNode | null;
}

function findByClass(
  node: FakeNode | string,
  className: string,
): FakeNode | null {
  if (typeof node === 'string') {
    return null;
  }
  if (
    String(node.attrs.class || '')
      .split(' ')
      .includes(className)
  ) {
    return node;
  }
  for (const child of node.children) {
    const found = findByClass(child, className);
    if (found) {
      return found;
    }
  }
  return null;
}

function fakeNode(type: string, attrs: unknown, children?: unknown): FakeNode {
  return {
    type,
    attrs: (attrs || {}) as Record<string, unknown>,
    children:
      children === undefined
        ? []
        : Array.isArray(children)
          ? (children as Array<FakeNode | string>)
          : [children as FakeNode | string],
    isConnected: true,
    scrollTop: 0,
    appendChild(child) {
      this.children.push(child);
    },
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
    replaceChildren(...nodes) {
      this.children = nodes;
    },
    querySelector(selector) {
      return findByClass(this, selector.replace(/^./, ''));
    },
  };
}

function textOf(node: FakeNode | string): string {
  return typeof node === 'string' ? node : node.children.map(textOf).join('');
}

const containers: Record<
  string,
  {
    children: FakeNode[];
    querySelectorAll(): FakeNode[];
    replaceChildren(...nodes: FakeNode[]): void;
  }
> = {};
let overlayActive = true;
let shownModal: FakeNode | null = null;
const stored = new Map<string, string>();
const COLLAPSED_KEY = 'forkop:dashboard-collapsed-sections:v1';

function container(id: string) {
  containers[id] ||= {
    children: [],
    querySelectorAll: () => [],
    replaceChildren(...nodes: FakeNode[]) {
      this.children = nodes;
    },
  };
  return containers[id];
}

function toolbarButton(label: string) {
  const toolbar = container('dashboard-sections-toolbar').children[0];
  return toolbar?.children.find(
    (child): child is FakeNode =>
      typeof child !== 'string' && textOf(child) === label,
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function section(
  name: string,
  overrides: Partial<Forkop.OutboundGroup> = {},
): Forkop.OutboundGroup {
  return {
    code: `${name}-out`,
    sectionName: name,
    displayName: name,
    withTagSelect: true,
    outbounds: [
      {
        code: `${name}/Node`,
        displayName: 'Node',
        latency: 0,
        type: 'VLESS',
        selected: true,
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  for (const mock of Object.values(mocks)) {
    mock.mockReset();
  }
  for (const id of Object.keys(containers)) {
    delete containers[id];
  }
  (globalThis as unknown as { E: unknown }).E = fakeNode;
  stored.clear();
  vi.stubGlobal('window', {
    location: { hostname: '192.168.1.1', protocol: 'http:' },
    localStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    },
    scrollY: 0,
    scrollTo() {},
    addEventListener() {},
  });
  vi.stubGlobal('requestAnimationFrame', () => 0);
  overlayActive = true;
  shownModal = null;
  vi.stubGlobal('ui', {
    showModal: (_title: string, content: FakeNode) => {
      shownModal = content;
    },
    hideModal: () => {},
  });
  vi.stubGlobal(
    'MutationObserver',
    class {
      observe() {}
    },
  );
  vi.stubGlobal('document', {
    visibilityState: 'visible',
    timeline: { currentTime: 0 },
    body: {
      classList: { contains: () => overlayActive },
    },
    getElementById: (id: string) =>
      id === 'dashboard-sections-grid' || id === 'dashboard-sections-toolbar'
        ? container(id)
        : null,
    createElementNS: (_namespace: string, type: string) => fakeNode(type, {}),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function openDashboard(data: Forkop.OutboundGroup[]) {
  mocks.getDashboardSections.mockResolvedValue({
    success: true,
    data,
  });
  const { store } = await import('../../../services/store.service');
  store.set({ tabService: { current: 'dashboard', all: [] } });
  const { initController } = await import('../initController');
  await initController();
  await vi.advanceTimersByTimeAsync(0);
}

describe('the dashboard toolbar', () => {
  it('offers only what there is to act on', async () => {
    await openDashboard([section('alone')]);

    expect(toolbarButton('Test all sections')).toBeUndefined();
    expect(toolbarButton('Update subscriptions')).toBeUndefined();
    expect(toolbarButton('Update lists')).toBeUndefined();
  });

  it('tests every section in turn, each once the one before has answered', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    mocks.getClashApiGroupLatency
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue({ success: true, data: {} });
    mocks.getClashApiProxyLatency.mockReturnValueOnce(second.promise);
    await openDashboard([
      section('first'),
      section('single', { withTagSelect: false }),
      section('last'),
    ]);

    (toolbarButton('Test all sections')?.attrs.click as () => void)();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.getClashApiGroupLatency.mock.calls).toEqual([['first-out']]);
    expect(mocks.getClashApiProxyLatency).not.toHaveBeenCalled();
    expect(toolbarButton('Test all sections')?.attrs.disabled).toBe(true);

    first.resolve({ success: true, data: {} });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.getClashApiProxyLatency.mock.calls).toEqual([['single/Node']]);
    expect(mocks.getClashApiGroupLatency).toHaveBeenCalledTimes(1);

    second.resolve({ success: true, data: { delay: 50 } });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.getClashApiGroupLatency.mock.calls).toEqual([
      ['first-out'],
      ['last-out'],
    ]);
    expect(toolbarButton('Test all sections')?.attrs.disabled).toBeUndefined();
  });

  it('stops at the first section the controller gave no answer for', async () => {
    mocks.getClashApiGroupLatency.mockResolvedValue({
      success: false,
      error: 'unreachable',
    });
    await openDashboard([section('first'), section('second')]);

    (toolbarButton('Test all sections')?.attrs.click as () => void)();
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.getClashApiGroupLatency).toHaveBeenCalledTimes(1);
    expect(mocks.showToast).toHaveBeenCalledOnce();
  });

  it('refreshes each subscription of every section once', async () => {
    mocks.updateClashApiProxyProviders.mockResolvedValue({ success: true });
    await openDashboard([
      section('office', { subscriptionProviderTags: ['office/sub1'] }),
      section('home', {
        subscriptionProviderTags: ['home/sub1', 'home/sub2'],
      }),
      section('plain'),
    ]);

    (toolbarButton('Update subscriptions')?.attrs.click as () => void)();
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.updateClashApiProxyProviders.mock.calls).toEqual([
      [['office/sub1', 'home/sub1', 'home/sub2']],
    ]);
    expect(mocks.showToast).toHaveBeenCalledWith(
      'Subscriptions updated',
      'success',
    );
  });
});

describe('failed manual latency tests', () => {
  const currentClass = 'fkp_dashboard-page__outbound-section__current';
  const latencyClass = 'fkp_dashboard-page__outbound-grid__item__latency';

  function root() {
    return container('dashboard-sections-grid').children[0];
  }

  function click(className: string) {
    const button = findByClass(root(), className);
    expect(button).not.toBeNull();
    (button!.attrs.click as (event: MouseEvent) => void)({
      preventDefault() {},
      stopPropagation() {},
    } as MouseEvent);
  }

  it.each([
    { success: false, error: 'Timeout', status: 504 },
    { success: false, error: 'unreachable' },
    { success: true, data: { delay: 0 } },
  ])(
    'shows red N/A after a proxy test returns %j, until a successful retry',
    async (response) => {
      const data = [section('first'), section('second')];
      data[0].outbounds[0].latency = 80;
      stored.set(COLLAPSED_KEY, JSON.stringify(['first']));
      mocks.getClashApiProxyLatency.mockResolvedValue(response);
      await openDashboard(data);
      expect(textOf(findByClass(root(), currentClass)!)).toBe('Node80ms');

      // Expand to reach the card, then fold it again after the request completes.
      click('fkp_dashboard-page__outbound-section__collapse');
      click(latencyClass);
      await vi.advanceTimersByTimeAsync(0);
      const card = findByClass(root(), latencyClass)!;
      expect(textOf(card)).toBe('N/A');
      expect(card.attrs.class).toContain('latency--red');
      click('fkp_dashboard-page__outbound-section__collapse');
      const current = findByClass(root(), currentClass)!;
      expect(textOf(current)).toBe('NodeN/A');
      expect(findByClass(current, `${latencyClass}--red`)).not.toBeNull();

      // Another snapshot still contains the old successful delay.
      const { store } = await import('../../../services/store.service');
      expect(
        store.get().sectionsWidget.data[0].outbounds[0].latencyFailed,
      ).toBe(true);

      data[0].outbounds[0].latency = 42;
      mocks.getClashApiProxyLatency.mockResolvedValue({
        success: true,
        data: { delay: 42 },
      });
      click('fkp_dashboard-page__outbound-section__collapse');
      click(latencyClass);
      await vi.advanceTimersByTimeAsync(0);
      expect(textOf(findByClass(root(), latencyClass)!)).toBe('42ms');
      expect(findByClass(root(), latencyClass)!.attrs.class).toContain(
        'latency--green',
      );
    },
  );

  it('marks group members missing from a manual sweep as unavailable', async () => {
    stored.set(COLLAPSED_KEY, JSON.stringify(['first']));
    mocks.getClashApiGroupLatency.mockResolvedValue({
      success: true,
      data: {},
    });
    await openDashboard([section('first'), section('second')]);
    expect(textOf(findByClass(root(), currentClass)!)).toBe('Node');

    click('dashboard-sections-grid-item-test-latency');
    await vi.advanceTimersByTimeAsync(0);

    const current = findByClass(root(), currentClass)!;
    expect(textOf(current)).toBe('NodeN/A');
    expect(findByClass(current, `${latencyClass}--red`)).not.toBeNull();
  });
});

describe('nested group latency failures', () => {
  it('propagates a missing selected member to the group and clears it on retry', async () => {
    const data = section('first');
    data.outbounds[0] = {
      code: 'first/Auto',
      displayName: 'Auto',
      type: 'URLTest',
      selected: true,
      latency: 80,
      urlTestInfo: {
        code: 'first/Auto',
        displayName: 'Auto',
        selectedCode: 'first/Node',
        outbounds: [
          {
            code: 'first/Node',
            displayName: 'Node',
            type: 'VLESS',
            selected: true,
            latency: 80,
          },
        ],
      },
    };
    mocks.getClashApiGroupLatency.mockResolvedValue({
      success: true,
      data: {},
    });
    await openDashboard([data, section('second')]);
    const clickTest = () => {
      const root = container('dashboard-sections-grid').children[0];
      const button = findByClass(
        root,
        'fkp_dashboard-page__outbound-grid__item__latency',
      )!;
      (button.attrs.click as (event: MouseEvent) => void)({
        preventDefault() {},
        stopPropagation() {},
      } as MouseEvent);
    };
    clickTest();
    await vi.advanceTimersByTimeAsync(0);
    const { store } = await import('../../../services/store.service');
    const group = () => store.get().sectionsWidget.data[0].outbounds[0];
    expect(group().latencyFailed).toBe(true);
    expect(group().latency).toBe(0);
    expect(group().urlTestInfo!.outbounds[0].latencyFailed).toBe(true);

    mocks.getClashApiGroupLatency.mockResolvedValue({
      success: true,
      data: { 'first/Node': 80 },
    });
    clickTest();
    await vi.advanceTimersByTimeAsync(0);
    expect(group().latencyFailed).toBe(false);
    expect(group().latency).toBe(80);
    expect(group().urlTestInfo!.outbounds[0].latencyFailed).toBe(false);
  });
});

describe('manual latency target ordering', () => {
  const latencyClass = 'fkp_dashboard-page__outbound-grid__item__latency';
  const sweepClass = 'dashboard-sections-grid-item-test-latency';

  function nested(selected = true): Forkop.OutboundGroup {
    return section('Office', {
      outbounds: [
        {
          code: 'Office/Auto',
          displayName: 'Auto',
          type: 'URLTest',
          selected: true,
          latency: 80,
          urlTestInfo: {
            code: 'Office/Auto',
            displayName: 'Auto',
            selectedCode: selected ? 'Office/Node' : '',
            outbounds: [
              {
                code: 'Office/Node',
                displayName: 'Node',
                type: 'VLESS',
                selected,
                latency: 80,
              },
            ],
          },
        },
      ],
    });
  }

  function click(className: string) {
    const root = container('dashboard-sections-grid').children[0];
    const button = findByClass(root, className)!;
    (button.attrs.click as (event: MouseEvent) => void)({
      preventDefault() {},
      stopPropagation() {},
    } as MouseEvent);
  }

  async function group() {
    const { store } = await import('../../../services/store.service');
    return store.get().sectionsWidget.data[0].outbounds[0];
  }

  function expectCard(value: string, color: string) {
    const root = container('dashboard-sections-grid').children[0];
    const card = findByClass(root, latencyClass)!;
    expect(textOf(card)).toBe(value);
    expect(card.attrs.class).toContain(`latency--${color}`);
  }

  it.each([175, 0])(
    'accepts ordinary background history %ims after overlapping manual successes settle',
    async (latency) => {
      const older = deferred<unknown>();
      mocks.getClashApiGroupLatency.mockReturnValueOnce(older.promise);
      mocks.getClashApiProxyLatency.mockResolvedValueOnce({
        success: true,
        data: { delay: 42 },
      });
      const data = section('Office');
      await openDashboard([data]);
      click(sweepClass);
      click(latencyClass);
      await vi.advanceTimersByTimeAsync(0);
      expectCard('42ms', 'green');

      const snapshot = structuredClone(data);
      snapshot.outbounds[0].latency = 90;
      mocks.getDashboardSections.mockResolvedValue({
        success: true,
        data: [snapshot],
      });
      await vi.advanceTimersByTimeAsync(2000);
      expectCard('42ms', 'green');
      older.resolve({ success: true, data: { 'Office/Node': 90 } });
      await vi.advanceTimersByTimeAsync(0);
      expectCard('42ms', 'green');

      snapshot.outbounds[0].latency = latency;
      await vi.advanceTimersByTimeAsync(10000);
      expectCard(latency ? `${latency}ms` : 'N/A', latency ? 'green' : 'empty');
    },
  );

  it('keeps a manual failure against ordinary stale snapshots for the same route', async () => {
    const data = section('Office');
    data.outbounds[0].latency = 80;
    mocks.getClashApiProxyLatency.mockResolvedValue({
      success: true,
      data: { delay: 0 },
    });
    await openDashboard([data]);
    click(latencyClass);
    await vi.advanceTimersByTimeAsync(20000);
    expectCard('N/A', 'red');
  });

  it('protects a retry from an ordinary poll already in flight and its queued forced snapshot', async () => {
    const pending = deferred<unknown>();
    const data = section('Office');
    await openDashboard([data]);
    mocks.getDashboardSections.mockReturnValueOnce(pending.promise);
    await vi.advanceTimersByTimeAsync(10000);
    mocks.getClashApiProxyLatency.mockResolvedValue({
      success: true,
      data: { delay: 42 },
    });
    click(latencyClass);
    await vi.advanceTimersByTimeAsync(0);
    expectCard('42ms', 'green');
    pending.resolve({ success: true, data: [data] });
    await vi.advanceTimersByTimeAsync(0);
    expectCard('42ms', 'green');
    await vi.advanceTimersByTimeAsync(10000);
    expectCard('N/A', 'empty');
  });

  it('does not resurrect an older child failure when a successful selector retry returns to polling', async () => {
    const data = nested();
    await openDashboard([data]);
    mocks.getClashApiGroupLatency.mockResolvedValueOnce({
      success: true,
      data: {},
    });
    click(latencyClass);
    await vi.advanceTimersByTimeAsync(0);
    expectCard('N/A', 'red');
    mocks.getClashApiGroupLatency.mockResolvedValueOnce({
      success: true,
      data: { 'Office/Auto': 42 },
    });
    click(sweepClass);
    await vi.advanceTimersByTimeAsync(0);
    expectCard('42ms', 'green');
    const snapshot = structuredClone(data);
    snapshot.outbounds[0].latency = 55;
    snapshot.outbounds[0].urlTestInfo!.outbounds[0].latency = 55;
    mocks.getDashboardSections.mockResolvedValue({
      success: true,
      data: [snapshot],
    });
    await vi.advanceTimersByTimeAsync(10000);
    expectCard('55ms', 'green');
  });

  it.each(
    ['URLTest', 'Fallback'].flatMap((type) => [
      { type, delay: 0 },
      { type, delay: 42 },
    ]),
  )(
    'reconciles a $type selector result ($delay ms) after failover',
    async ({ type, delay }) => {
      const data = nested();
      const outbound = data.outbounds[0];
      outbound.urlTestInfo!.outbounds.push({
        code: 'Office/Backup',
        displayName: 'Backup',
        type: 'VLESS',
        selected: false,
        latency: 55,
      });
      if (type === 'Fallback') {
        outbound.type = type;
        outbound.fallbackInfo = {
          ...outbound.urlTestInfo!,
          outbounds: outbound.urlTestInfo!.outbounds.map((member) => ({
            ...member,
            levelIndex: 0,
            levelName: 'Primary',
            levelId: 'primary',
            pinned: false,
          })),
        };
        delete outbound.urlTestInfo;
      }
      mocks.getClashApiGroupLatency.mockResolvedValue({
        success: true,
        data: { 'Office/Auto': delay },
      });
      await openDashboard([data, section('second')]);
      click(sweepClass);
      await vi.advanceTimersByTimeAsync(0);
      expectCard(delay ? '42ms' : 'N/A', delay ? 'green' : 'red');

      const snapshot = structuredClone(data);
      const current = snapshot.outbounds[0];
      const info = current.urlTestInfo || current.fallbackInfo!;
      info.selectedCode = 'Office/Backup';
      info.outbounds[0].selected = false;
      info.outbounds[1].selected = true;
      current.latency = 55;
      mocks.getDashboardSections.mockResolvedValue({
        success: true,
        data: [snapshot, section('second')],
      });
      // A second manual request forces a snapshot while positive overlays are still protected.
      click('dashboard-sections-grid-item-test-latency');
      await vi.advanceTimersByTimeAsync(0);
      expectCard('55ms', 'green');
      click('fkp_dashboard-page__outbound-section__collapse');
      const header = findByClass(
        container('dashboard-sections-grid').children[0],
        'fkp_dashboard-page__outbound-section__current',
      )!;
      expect(textOf(header)).toBe('Auto55ms');
    },
  );

  it.each(['URLTest', 'Fallback'])(
    'follows the healthy member selected during a %s sweep',
    async (type) => {
      const data = nested();
      const outbound = data.outbounds[0];
      const info = outbound.urlTestInfo!;
      info.outbounds.push({
        code: 'Office/Backup',
        displayName: 'Backup',
        type: 'VLESS',
        selected: false,
        latency: 0,
      });
      if (type === 'Fallback') {
        outbound.type = type;
        outbound.fallbackInfo = {
          ...info,
          outbounds: info.outbounds.map((member) => ({
            ...member,
            levelIndex: 0,
            levelName: 'Primary',
            levelId: 'primary',
            pinned: false,
          })),
        };
        delete outbound.urlTestInfo;
      }
      const older = deferred<unknown>();
      mocks.getClashApiGroupLatency.mockReturnValueOnce(older.promise);
      await openDashboard([data, section('second')]);
      click(latencyClass);

      // The core selects the successful backup before answering the sweep.
      const snapshot = structuredClone(data);
      const current = snapshot.outbounds[0];
      const currentInfo = current.urlTestInfo || current.fallbackInfo!;
      currentInfo.selectedCode = 'Office/Backup';
      currentInfo.outbounds[0].selected = false;
      currentInfo.outbounds[1].selected = true;
      currentInfo.outbounds[1].latency = 42;
      current.latency = 42;
      mocks.getDashboardSections.mockResolvedValue({
        success: true,
        data: [snapshot, section('second')],
      });
      older.resolve({ success: true, data: { 'Office/Backup': 42 } });
      await vi.advanceTimersByTimeAsync(0);
      expectCard('42ms', 'green');
      const updated = await group();
      expect(updated.latencyFailed).toBe(false);
      expect(
        (updated.urlTestInfo || updated.fallbackInfo)!.outbounds[0],
      ).toMatchObject({ latency: 0, latencyFailed: true });
      click('fkp_dashboard-page__outbound-section__collapse');
      const header = findByClass(
        container('dashboard-sections-grid').children[0],
        'fkp_dashboard-page__outbound-section__current',
      )!;
      expect(textOf(header)).toBe('Auto42ms');
      expect(findByClass(header, `${latencyClass}--green`)).not.toBeNull();
    },
  );

  it.each([
    { nestedGroup: false, staleLatency: 90 },
    { nestedGroup: false, staleLatency: 0 },
    { nestedGroup: true, staleLatency: 90 },
    { nestedGroup: true, staleLatency: 0 },
  ])(
    'preserves a newer successful retry through an older response and stale snapshot: %j',
    async ({ nestedGroup, staleLatency }) => {
      const older = deferred<unknown>();
      const data = nestedGroup ? nested() : section('Office');
      mocks.getClashApiGroupLatency.mockReturnValueOnce(older.promise);
      await openDashboard([data, section('second')]);
      click(sweepClass);
      if (nestedGroup) {
        mocks.getClashApiGroupLatency.mockResolvedValueOnce({
          success: true,
          data: {},
        });
      } else {
        mocks.getClashApiProxyLatency.mockResolvedValueOnce({
          success: true,
          data: { delay: 0 },
        });
      }
      click(latencyClass);
      await vi.advanceTimersByTimeAsync(0);
      expectCard('N/A', 'red');
      const success = {
        success: true,
        data: nestedGroup ? { 'Office/Node': 42 } : { delay: 42 },
      };
      const successfulSnapshot = structuredClone(data);
      successfulSnapshot.outbounds[0].latency = 42;
      if (nestedGroup)
        successfulSnapshot.outbounds[0].urlTestInfo!.outbounds[0].latency = 42;
      mocks.getDashboardSections.mockResolvedValue({
        success: true,
        data: [successfulSnapshot, section('second')],
      });
      if (nestedGroup)
        mocks.getClashApiGroupLatency.mockResolvedValueOnce(success);
      else mocks.getClashApiProxyLatency.mockResolvedValueOnce(success);
      click(latencyClass);
      await vi.advanceTimersByTimeAsync(0);
      expectCard('42ms', 'green');

      // An older core request can replace history or delete it after the retry.
      const snapshot = structuredClone(data);
      snapshot.outbounds[0].latency = staleLatency;
      if (nestedGroup)
        snapshot.outbounds[0].urlTestInfo!.outbounds[0].latency = staleLatency;
      mocks.getDashboardSections.mockResolvedValue({
        success: true,
        data: [snapshot, section('second')],
      });
      older.resolve({
        success: true,
        data: staleLatency ? { [data.outbounds[0].code]: staleLatency } : {},
      });
      const snapshotsBefore = mocks.getDashboardSections.mock.calls.length;
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.getDashboardSections.mock.calls.length).toBeGreaterThan(
        snapshotsBefore,
      );
      expectCard('42ms', 'green');
      click('fkp_dashboard-page__outbound-section__collapse');
      const header = findByClass(
        container('dashboard-sections-grid').children[0],
        'fkp_dashboard-page__outbound-section__current',
      )!;
      expect(textOf(header)).toBe(`${nestedGroup ? 'Auto' : 'Node'}42ms`);
    },
  );

  it('uses immediate members for a selector sweep without failing nested children', async () => {
    const data = nested();
    mocks.getClashApiGroupLatency.mockResolvedValue({
      success: true,
      data: { 'Office/Auto': 45 },
    });
    await openDashboard([data]);
    // Leave the post-test snapshot pending so it cannot hide the immediate result.
    mocks.getDashboardSections.mockReturnValue(new Promise(() => {}));
    click(sweepClass);
    await vi.advanceTimersByTimeAsync(0);
    expectCard('45ms', 'green');
    expect((await group()).urlTestInfo!.outbounds[0]).toMatchObject({
      latency: 80,
      latencyFailed: false,
    });
  });

  it.each([{}, { 'Office/Auto': 0 }])(
    'clears older child failures on a successful selector retry after %j',
    async (result) => {
      mocks.getClashApiGroupLatency.mockResolvedValueOnce({
        success: true,
        data: {},
      });
      await openDashboard([nested()]);
      click(latencyClass);
      await vi.advanceTimersByTimeAsync(0);
      expectCard('N/A', 'red');
      mocks.getClashApiGroupLatency.mockResolvedValueOnce({
        success: true,
        data: result,
      });
      click(sweepClass);
      await vi.advanceTimersByTimeAsync(0);
      expectCard('N/A', 'red');
      mocks.getDashboardSections.mockReturnValue(new Promise(() => {}));
      mocks.getClashApiGroupLatency.mockResolvedValueOnce({
        success: true,
        data: { 'Office/Auto': 45 },
      });
      click(sweepClass);
      await vi.advanceTimersByTimeAsync(0);
      expectCard('45ms', 'green');
    },
  );

  it.each([
    { success: true, data: {} },
    { success: true, data: { 'Office/Node': 0 } },
    { success: false, error: 'Timeout', status: 504 },
  ])(
    'fails a tested nonempty group without a selection for %j and recovers',
    async (response) => {
      mocks.getClashApiGroupLatency.mockResolvedValue(response);
      await openDashboard([nested(false), section('second')]);
      click(latencyClass);
      await vi.advanceTimersByTimeAsync(0);
      expectCard('N/A', 'red');
      click('fkp_dashboard-page__outbound-section__collapse');
      const current = findByClass(
        container('dashboard-sections-grid').children[0],
        'fkp_dashboard-page__outbound-section__current',
      )!;
      expect(textOf(current)).toBe('AutoN/A');
      expect(findByClass(current, `${latencyClass}--red`)).not.toBeNull();
      click('fkp_dashboard-page__outbound-section__collapse');
      mocks.getDashboardSections.mockReturnValue(new Promise(() => {}));
      mocks.getClashApiGroupLatency.mockResolvedValue({
        success: true,
        data: { 'Office/Node': 42 },
      });
      click(latencyClass);
      await vi.advanceTimersByTimeAsync(0);
      expectCard('42ms', 'green');
    },
  );

  it.each([false, true])(
    'keeps the newer card success when an older section failure finishes late (nested=%s)',
    async (nestedGroup) => {
      const older = deferred<unknown>();
      mocks.getClashApiGroupLatency.mockReturnValueOnce(older.promise);
      const data = nestedGroup ? nested() : section('Office');
      await openDashboard([data]);
      mocks.getDashboardSections.mockReturnValue(new Promise(() => {}));
      click(sweepClass);
      const response = {
        success: true,
        data: nestedGroup ? { 'Office/Node': 42 } : { delay: 42 },
      };
      if (nestedGroup)
        mocks.getClashApiGroupLatency.mockResolvedValueOnce(response);
      else mocks.getClashApiProxyLatency.mockResolvedValueOnce(response);
      click(latencyClass);
      await vi.advanceTimersByTimeAsync(0);
      expectCard('42ms', 'green');
      older.resolve({ success: true, data: {} });
      await vi.advanceTimersByTimeAsync(0);
      expectCard('42ms', 'green');
      expect((await group()).latencyFailed).toBe(false);
    },
  );

  it.each([
    { success: true, data: {} },
    { success: true, data: { 'Office/Node': 77 } },
    { success: false, error: 'Timeout', status: 504 },
  ])(
    'keeps a newer selector success after an older direct group result %j',
    async (response) => {
      const older = deferred<unknown>();
      mocks.getClashApiGroupLatency
        .mockReturnValueOnce(older.promise)
        .mockResolvedValueOnce({ success: true, data: { 'Office/Auto': 45 } });
      await openDashboard([nested()]);
      mocks.getDashboardSections.mockReturnValue(new Promise(() => {}));
      click(latencyClass);
      click(sweepClass);
      await vi.advanceTimersByTimeAsync(0);
      expectCard('45ms', 'green');
      older.resolve(response);
      await vi.advanceTimersByTimeAsync(0);
      expectCard('45ms', 'green');
    },
  );

  it('applies an older sweep to other targets while preserving the newer card result', async () => {
    const older = deferred<unknown>();
    const data = section('Office');
    data.outbounds.push({
      code: 'Office/Other',
      displayName: 'Other',
      type: 'VLESS',
      selected: false,
      latency: 80,
    });
    mocks.getClashApiGroupLatency.mockReturnValueOnce(older.promise);
    mocks.getClashApiProxyLatency.mockResolvedValueOnce({
      success: true,
      data: { delay: 42 },
    });
    await openDashboard([data]);
    mocks.getDashboardSections.mockReturnValue(new Promise(() => {}));
    click(sweepClass);
    click(latencyClass);
    await vi.advanceTimersByTimeAsync(0);
    older.resolve({ success: true, data: {} });
    await vi.advanceTimersByTimeAsync(0);
    expectCard('42ms', 'green');
    const { store } = await import('../../../services/store.service');
    expect(store.get().sectionsWidget.data[0].outbounds[1]).toMatchObject({
      latency: 0,
      latencyFailed: true,
    });
  });

  it('keeps a newer initiated failure even when an older success completes last', async () => {
    const older = deferred<unknown>();
    const newer = deferred<unknown>();
    mocks.getClashApiGroupLatency.mockReturnValueOnce(older.promise);
    mocks.getClashApiProxyLatency.mockReturnValueOnce(newer.promise);
    await openDashboard([section('Office')]);
    click(sweepClass);
    click(latencyClass);
    newer.resolve({ success: true, data: { delay: 0 } });
    await vi.advanceTimersByTimeAsync(0);
    expectCard('N/A', 'red');
    older.resolve({ success: true, data: { 'Office/Node': 45 } });
    await vi.advanceTimersByTimeAsync(0);
    expectCard('N/A', 'red');
  });
});

describe('folded sections', () => {
  function rendered(name: string) {
    return container('dashboard-sections-grid').children.find((root) =>
      textOf(root).includes(name),
    );
  }

  function collapseButton(name: string) {
    const find = (node: FakeNode | string): FakeNode | undefined => {
      if (typeof node === 'string') {
        return undefined;
      }
      if (
        String(node.attrs.class || '').includes(
          'fkp_dashboard-page__outbound-section__collapse',
        )
      ) {
        return node;
      }
      for (const child of node.children) {
        const found = find(child);
        if (found) {
          return found;
        }
      }
      return undefined;
    };
    return find(rendered(name) as FakeNode);
  }

  it('stay folded on the next visit', async () => {
    stored.set(COLLAPSED_KEY, JSON.stringify(['second']));
    await openDashboard([section('first'), section('second')]);

    expect(collapseButton('first')?.attrs['aria-expanded']).toBe('true');
    expect(collapseButton('second')?.attrs['aria-expanded']).toBe('false');
  });

  it('are stored as they are folded, without sections that are gone', async () => {
    stored.set(COLLAPSED_KEY, JSON.stringify(['removed', 'first']));
    await openDashboard([section('first'), section('second')]);

    (collapseButton('second')?.attrs.click as (event: MouseEvent) => void)({
      preventDefault() {},
      stopPropagation() {},
    } as MouseEvent);
    expect(JSON.parse(stored.get(COLLAPSED_KEY) || '[]')).toEqual([
      'first',
      'second',
    ]);

    (collapseButton('first')?.attrs.click as (event: MouseEvent) => void)({
      preventDefault() {},
      stopPropagation() {},
    } as MouseEvent);
    expect(JSON.parse(stored.get(COLLAPSED_KEY) || '[]')).toEqual(['second']);
  });

  it('still fold when the browser keeps nothing', async () => {
    stored.set(COLLAPSED_KEY, 'not json');
    await openDashboard([section('first'), section('second')]);

    expect(collapseButton('first')?.attrs['aria-expanded']).toBe('true');
    (collapseButton('first')?.attrs.click as (event: MouseEvent) => void)({
      preventDefault() {},
      stopPropagation() {},
    } as MouseEvent);
    expect(collapseButton('first')?.attrs['aria-expanded']).toBe('false');
  });
});

describe('the Desync details dialog', () => {
  const snapshot = {
    outbounds: {
      YouTube: {
        current: 'disorder',
        entries: {
          'global|route:123': {
            strategies: { disorder: { success: 86, failure: 22 } },
          },
        },
      },
    },
  };

  function find(node: FakeNode | string, label: string): FakeNode | undefined {
    if (typeof node === 'string') return;
    if (
      node.attrs['aria-label'] === label ||
      (node.type === 'button' && textOf(node) === label)
    )
      return node;
    for (const child of node.children) {
      const found = find(child, label);
      if (found) return found;
    }
  }

  async function openDesyncDetails() {
    await openDashboard([
      section('cfg_desync', {
        displayName: 'YouTube',
        action: 'desync',
        withTagSelect: false,
        outbounds: [
          {
            code: 'YouTube',
            displayName: 'YouTube',
            type: 'Desync',
            selected: true,
            latency: 0,
          },
        ],
      }),
      section('other'),
    ]);
    const info = find(
      container('dashboard-sections-grid').children[0],
      'Desync details',
    );
    expect(info).toBeDefined();
    const stopPropagation = vi.fn();
    (info!.attrs.click as (event: object) => void)({ stopPropagation });
    expect(stopPropagation).toHaveBeenCalledOnce();
    return shownModal as unknown as FakeNode;
  }

  function click(dialog: FakeNode, label: string) {
    (find(dialog, label)!.attrs.click as () => void)();
  }

  it('loads the clicked section automatically and keeps its JSON collapsed', async () => {
    const response = deferred<typeof snapshot>();
    mocks.desyncDiagnostics.mockReturnValue(response.promise);
    const dialog = await openDesyncDetails();
    const raw = findByClass(dialog, 'fkp-desync__panel')!;
    expect(mocks.desyncDiagnostics).toHaveBeenCalledExactlyOnceWith(
      'cfg_desync',
    );
    expect(raw.hidden).toBe(true);
    expect(find(dialog, 'Refresh diagnostics')?.disabled).toBe(true);
    expect(find(dialog, 'Clear learning results')?.disabled).toBe(true);

    response.resolve(snapshot);
    await vi.advanceTimersByTimeAsync(0);

    expect(textOf(dialog)).toContain('86');
    expect(raw.hidden).toBe(false);
    expect(raw.attrs.open).toBeUndefined();
    expect(findByClass(raw, 'fkp-desync__result-json')?.textContent).toBe(
      JSON.stringify(snapshot, null, 2),
    );
    expect(find(dialog, 'Refresh diagnostics')?.disabled).toBe(false);
    expect(mocks.getClashApiProxyLatency).not.toHaveBeenCalled();
  });

  it('refreshes and clears only the selected section, preserving JSON disclosure', async () => {
    mocks.desyncDiagnostics.mockResolvedValue(snapshot);
    mocks.clearDesync.mockResolvedValue({ success: true });
    const dialog = await openDesyncDetails();
    await vi.advanceTimersByTimeAsync(0);
    const raw = findByClass(dialog, 'fkp-desync__panel')!;
    raw.attrs.open = '';

    click(dialog, 'Refresh diagnostics');
    await vi.advanceTimersByTimeAsync(0);
    click(dialog, 'Clear learning results');
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.clearDesync).toHaveBeenCalledExactlyOnceWith('cfg_desync');
    expect(mocks.desyncDiagnostics.mock.calls).toEqual([
      ['cfg_desync'],
      ['cfg_desync'],
      ['cfg_desync'],
    ]);
    expect(raw.attrs.open).toBe('');
  });

  it('keeps refresh errors and expanded JSON with the results, outside the persistent actions', async () => {
    mocks.desyncDiagnostics.mockResolvedValueOnce(snapshot);
    const dialog = await openDesyncDetails();
    await vi.advanceTimersByTimeAsync(0);
    const results = find(dialog, 'Desync details')!;
    const raw = findByClass(results, 'fkp-desync__panel')!;
    expect(raw).not.toBeNull();
    raw.attrs.open = '';

    mocks.desyncDiagnostics.mockRejectedValueOnce(new Error('Offline'));
    click(dialog, 'Refresh diagnostics');
    await vi.advanceTimersByTimeAsync(0);

    expect(findByClass(results, 'fkp-desync__error')?.textContent).toBe(
      'Offline',
    );
    expect(textOf(results)).toContain('86');
    expect(raw.attrs.open).toBe('');
    expect(findByClass(raw, 'fkp-desync__result-json')?.textContent).toBe(
      JSON.stringify(snapshot, null, 2),
    );
    for (const label of [
      'Refresh diagnostics',
      'Clear learning results',
      'Close',
    ]) {
      expect(find(dialog, label)?.disabled).not.toBe(true);
      expect(find(results, label)).toBeUndefined();
    }
  });

  it('shows load failures and allows a retry', async () => {
    mocks.desyncDiagnostics
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValue(snapshot);
    const dialog = await openDesyncDetails();
    await vi.advanceTimersByTimeAsync(0);
    const error = findByClass(dialog, 'fkp-desync__error')!;
    expect(error.textContent).toBe('Offline');
    expect(find(dialog, 'Refresh diagnostics')?.disabled).toBe(false);
    click(dialog, 'Refresh diagnostics');
    await vi.advanceTimersByTimeAsync(0);
    expect(error.textContent).toBe('');
    expect(textOf(dialog)).toContain('86');
  });
});

describe('the group details dialogs', () => {
  function urlTestSection(latency: number) {
    return section('main', {
      outbounds: [
        {
          code: 'main/auto',
          displayName: 'Auto',
          latency,
          type: 'URLTest',
          selected: true,
          urlTestInfo: {
            code: 'main/auto',
            displayName: 'Auto',
            outbounds: [
              {
                code: 'main/node',
                displayName: 'Node',
                latency,
                type: 'VLESS',
                selected: true,
              },
            ],
          },
        },
      ],
    });
  }

  async function openUrlTestDetails() {
    const button = (function find(node: FakeNode | string): FakeNode | null {
      if (typeof node === 'string') return null;
      if (node.attrs['aria-label'] === 'URLTest details') return node;
      for (const child of node.children) {
        const found = find(child);
        if (found) return found;
      }
      return null;
    })(container('dashboard-sections-grid').children[0]);
    (button?.attrs.click as (event: MouseEvent) => void)({
      stopPropagation() {},
    } as MouseEvent);
    return shownModal as unknown as FakeNode;
  }

  async function publish(data: Forkop.OutboundGroup[]) {
    const { store } = await import('../../../services/store.service');
    store.set({
      sectionsWidget: { ...store.get().sectionsWidget, data },
    });
    await vi.advanceTimersByTimeAsync(0);
  }

  it('follow the sections refresh and keep the list where it was scrolled', async () => {
    await openDashboard([urlTestSection(50), section('other')]);
    const dialog = await openUrlTestDetails();
    expect(textOf(dialog)).toContain('50ms');
    dialog.querySelector(
      '.fkp_dashboard-page__urltest-details__table',
    )!.scrollTop = 120;

    await publish([urlTestSection(70), section('other')]);

    expect(textOf(dialog)).toContain('70ms');
    expect(
      dialog.querySelector('.fkp_dashboard-page__urltest-details__table')
        ?.scrollTop,
    ).toBe(120);
  });

  it('stop redrawing once LuCI has closed them', async () => {
    await openDashboard([urlTestSection(50), section('other')]);
    const dialog = await openUrlTestDetails();

    overlayActive = false;
    await publish([urlTestSection(70), section('other')]);
    overlayActive = true;
    await publish([urlTestSection(90), section('other')]);

    expect(textOf(dialog)).toContain('50ms');
  });

  function fallbackSection(levels: string[]) {
    return section('chain', {
      outbounds: [
        {
          code: 'chain/fallback',
          displayName: 'Fallback',
          latency: 0,
          type: 'Fallback',
          selected: true,
          fallbackInfo: {
            code: 'chain/fallback',
            displayName: 'Fallback',
            outbounds: levels.map((level, index) => ({
              code: `chain/node${index}`,
              displayName: `Node ${index}`,
              latency: 0,
              type: 'VLESS',
              selected: index === 0,
              pinned: false,
              levelIndex: index,
              levelName: level,
              levelId: level,
            })),
          },
        },
      ],
    });
  }

  async function fallbackLevelChips(levels: string[]) {
    await openDashboard([fallbackSection(levels), section('other')]);
    const button = (function find(node: FakeNode | string): FakeNode | null {
      if (typeof node === 'string') return null;
      if (node.attrs['aria-label'] === 'Fallback details') return node;
      for (const child of node.children) {
        const found = find(child);
        if (found) return found;
      }
      return null;
    })(container('dashboard-sections-grid').children[0]);
    (button?.attrs.click as (event: MouseEvent) => void)({
      stopPropagation() {},
    } as MouseEvent);
    const chips: string[] = [];
    (function collect(node: FakeNode | string) {
      if (typeof node === 'string') return;
      if (
        String(node.attrs.class || '').includes(
          'fkp_dashboard-page__urltest-details__fallback-level',
        )
      ) {
        chips.push(textOf(node));
      }
      node.children.forEach(collect);
    })(shownModal as unknown as FakeNode);
    return chips;
  }

  it('name a fallback level on a node only when there are levels to tell apart', async () => {
    expect(await fallbackLevelChips(['Group #1', 'Group #1'])).toEqual([]);
  });

  it('name it on every node, the chosen one included, when there are', async () => {
    expect(await fallbackLevelChips(['Group #1', 'Group #2'])).toEqual([
      'Group #1',
      'Group #1',
      'Group #2',
    ]);
  });
});
