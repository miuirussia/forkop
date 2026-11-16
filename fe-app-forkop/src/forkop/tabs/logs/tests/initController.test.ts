import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ checkLogs: vi.fn() }));
const savedValues = new Map<string, string>();

vi.mock('../../../methods', () => ({
  ForkopShellMethods: { checkLogs: mocks.checkLogs },
}));
vi.mock('../../../../helpers/onMount', () => ({ onMount: async () => ({}) }));
vi.mock('../../../../icons', () => ({ renderSearchIcon24: () => ({}) }));

function page() {
  const nodes: Record<string, Record<string, unknown>> = {};
  const node = (id: string) =>
    (nodes[id] ??= {
      textContent: 'Loading logs...',
      value: '',
      checked: false,
      disabled: false,
      scrollTop: 0,
      scrollLeft: 0,
      scrollHeight: 0,
      clientHeight: 0,
      offsetParent: {},
      classList: { toggle() {} },
      setAttribute() {},
      addEventListener: vi.fn(),
    });
  vi.stubGlobal('document', {
    hidden: false,
    getElementById: node,
    querySelector: () => null,
  });
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => callback());
  return node;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  mocks.checkLogs.mockReset();
  savedValues.clear();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => savedValues.get(key) ?? null,
      setItem: (key: string, value: string) => savedValues.set(key, value),
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function trigger(node: ReturnType<typeof page>, id: string, event = 'click') {
  const listener = (
    node(id).addEventListener as ReturnType<typeof vi.fn>
  ).mock.calls.find(([type]) => type === event)?.[1];
  expect(listener).toBeTypeOf('function');
  listener();
}

async function openedOn(tab: string) {
  const { store } = await import('../../../services/store.service');
  store.set({ tabService: { current: tab, all: [] } });
  const { initController } = await import('../initController');
  return initController;
}

async function switchTo(tab: string) {
  const { store } = await import('../../../services/store.service');
  store.set({ tabService: { current: tab, all: [] } });
}

describe('the Logs tab', () => {
  it('says there are no logs once an empty log arrives', async () => {
    const node = page();
    mocks.checkLogs.mockResolvedValue({ success: true, data: '' });
    const initController = await openedOn('logs');

    await initController();
    await Promise.resolve();

    expect(node('logs-output').textContent).toBe('No logs available');
    expect(node('logs-clear').disabled).toBe(true);
  });

  it('says the read failed when it did', async () => {
    const node = page();
    mocks.checkLogs.mockResolvedValue({ success: false, error: 'refused' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const initController = await openedOn('logs');

    await initController();
    await Promise.resolve();

    expect(node('logs-output').textContent).toBe('Failed to load logs');
  });

  it('names the buttons for what a search found', async () => {
    const node = page();
    mocks.checkLogs.mockResolvedValue({ success: true, data: 'one\ntwo' });
    node('logs-search').value = 'two';
    const initController = await openedOn('logs');

    await initController();
    await Promise.resolve();

    expect(node('logs-output').textContent).toBe('two');
    expect(node('logs-copy').textContent).toBe('Copy matching');
    expect(node('logs-download').textContent).toBe('Download matching');
  });

  it('keeps the plain labels without a search', async () => {
    const node = page();
    mocks.checkLogs.mockResolvedValue({ success: true, data: 'one\ntwo' });
    const initController = await openedOn('logs');

    await initController();
    await Promise.resolve();

    expect(node('logs-copy').textContent).toBe('Copy');
    expect(node('logs-download').textContent).toBe('Download');
  });

  it('reads nothing while another tab is shown, and reads once it is', async () => {
    page();
    mocks.checkLogs.mockResolvedValue({ success: true, data: 'line' });
    const initController = await openedOn('section');

    await initController();
    await vi.advanceTimersByTimeAsync(6000);
    expect(mocks.checkLogs).not.toHaveBeenCalled();

    await switchTo('logs');
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.checkLogs).toHaveBeenCalledTimes(1);
  });

  it('clears all loaded logs even with a search, and keeps them cleared on refresh', async () => {
    const node = page();
    mocks.checkLogs.mockResolvedValue({ success: true, data: 'one\ntwo\n' });
    node('logs-search').value = 'one';
    const initController = await openedOn('logs');
    await initController();
    await vi.advanceTimersByTimeAsync(0);

    node('logs-output').scrollTop = 100;
    node('logs-output').scrollLeft = 50;
    trigger(node, 'logs-clear');
    expect(node('logs-output').textContent).toBe('No logs available');
    expect(node('logs-output').scrollTop).toBe(0);
    expect(node('logs-output').scrollLeft).toBe(0);
    for (const action of ['clear', 'copy', 'download']) {
      expect(node(`logs-${action}`).disabled).toBe(true);
    }

    node('logs-search').value = '';
    trigger(node, 'logs-search', 'input');
    await vi.advanceTimersByTimeAsync(2000);
    expect(node('logs-output').textContent).toBe('No logs available');
  });

  it('shows only new entries after clearing and can clear again', async () => {
    const node = page();
    mocks.checkLogs.mockResolvedValue({ success: true, data: 'one\ntwo\n' });
    const initController = await openedOn('logs');
    await initController();
    await vi.advanceTimersByTimeAsync(0);
    trigger(node, 'logs-clear');

    mocks.checkLogs.mockResolvedValue({
      success: true,
      data: 'one\ntwo\nthree\n',
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(node('logs-output').textContent).toBe('three');
    expect(node('logs-clear').disabled).toBe(false);
    expect(node('logs-copy').disabled).toBe(false);
    expect(node('logs-download').disabled).toBe(false);

    trigger(node, 'logs-clear');
    mocks.checkLogs.mockResolvedValue({
      success: true,
      data: 'one\ntwo\nthree\nfour\n',
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(node('logs-output').textContent).toBe('four');
  });

  it('keeps new entries when the cleared boundary rotates out of the log', async () => {
    const node = page();
    mocks.checkLogs.mockResolvedValue({ success: true, data: 'one\ntwo\n' });
    const initController = await openedOn('logs');
    await initController();
    await vi.advanceTimersByTimeAsync(0);
    trigger(node, 'logs-clear');

    mocks.checkLogs.mockResolvedValue({ success: true, data: 'three\nfour\n' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(node('logs-output').textContent).toBe('three\nfour');
  });

  it.each([
    ['one\ntwo\n', 'one\ntwo\nthree\ntwo\nfour\n', 'three\ntwo\nfour'],
    ['one\ntwo\n', 'two\nthree\ntwo\n', 'three\ntwo'],
    ['one\ntwo\ntwo\n', 'one\ntwo\ntwo\nthree\ntwo\n', 'three\ntwo'],
    ['one\ntwo\ntwo\n', 'two\ntwo\nthree\ntwo\n', 'three\ntwo'],
  ])(
    'keeps new repeated lines after clearing %j',
    async (initial, refreshed, expected) => {
      const node = page();
      mocks.checkLogs.mockResolvedValue({ success: true, data: initial });
      const initController = await openedOn('logs');
      await initController();
      await vi.advanceTimersByTimeAsync(0);
      trigger(node, 'logs-clear');

      mocks.checkLogs.mockResolvedValue({ success: true, data: refreshed });
      await vi.advanceTimersByTimeAsync(2000);
      expect(node('logs-output').textContent).toBe(expected);
    },
  );

  it('keeps clearing effective when a pending refresh finishes', async () => {
    const node = page();
    mocks.checkLogs.mockResolvedValue({ success: true, data: 'one\ntwo\n' });
    const initController = await openedOn('logs');
    await initController();
    await vi.advanceTimersByTimeAsync(0);

    let finish!: (response: { success: boolean; data: string }) => void;
    mocks.checkLogs.mockReturnValue(
      new Promise((resolve) => (finish = resolve)),
    );
    await vi.advanceTimersByTimeAsync(2000);
    trigger(node, 'logs-clear');
    finish({ success: true, data: 'one\ntwo\nthree\n' });
    await vi.advanceTimersByTimeAsync(0);
    expect(node('logs-output').textContent).toBe('three');
  });

  it.each([
    ['one\ntwo\n', 'No logs available'],
    ['one\ntwo\nthree\n', 'three'],
    ['three\nfour\n', 'three\nfour'],
    ['one\ntwo\nthree\ntwo\n', 'three\ntwo'],
    ['two\nthree\ntwo\n', 'three\ntwo'],
  ])(
    'preserves clearing after a page reload with %j',
    async (logs, expected) => {
      const node = page();
      mocks.checkLogs.mockResolvedValue({ success: true, data: 'one\ntwo\n' });
      const initController = await openedOn('logs');
      await initController();
      await vi.advanceTimersByTimeAsync(0);
      trigger(node, 'logs-clear');

      vi.clearAllTimers();
      vi.resetModules();
      const reloadedPage = page();
      mocks.checkLogs.mockResolvedValue({ success: true, data: logs });
      const reloadedController = await openedOn('logs');
      await reloadedController();
      await vi.advanceTimersByTimeAsync(0);

      expect(reloadedPage('logs-output').textContent).toBe(expected);
    },
  );

  it.each(['getItem', 'setItem'] as const)(
    'keeps loading and clearing functional when storage %s fails',
    async (method) => {
      vi.spyOn(window.localStorage, method).mockImplementation(() => {
        throw new Error('Storage unavailable');
      });
      const node = page();
      mocks.checkLogs.mockResolvedValue({ success: true, data: 'one\ntwo\n' });
      const initController = await openedOn('logs');
      await initController();
      await vi.advanceTimersByTimeAsync(0);
      expect(node('logs-output').textContent).toBe('one\ntwo');

      trigger(node, 'logs-clear');
      expect(node('logs-output').textContent).toBe('No logs available');
    },
  );
});
