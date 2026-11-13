import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../services/geodata.service', () => ({
  getGeodataState: vi.fn(),
  updateGeodata: vi.fn(),
  validateGeodataInterval: vi.fn(),
}));
vi.mock('../../settings/sectionChoices', () => ({
  configureDownloadSectionOption: vi.fn(),
}));
vi.mock('../../settings/form/updates', () => ({
  addRuleSetUpdateOptions: vi.fn(),
}));

import {
  type GeodataState,
  getGeodataState,
  updateGeodata,
} from '../../../services/geodata.service';
import { createGeodataContent } from '../index';

class TestNode {
  isConnected = true;
  textContent = '';
  constructor(
    public attrs: Record<string, unknown>,
    public children: TestNode[],
  ) {}
  click() {
    (this.attrs.click as () => void)();
  }
}

function source(id: string, tagCount = 0, error = '') {
  return {
    id,
    kind: 'geosite' as const,
    label: id,
    ready: tagCount > 0,
    tag_count: tagCount,
    size: tagCount * 1024,
    updated_at: tagCount,
    error,
    used_tags: [],
  };
}

let snapshot: GeodataState;
let modal: TestNode[];
let options: Record<string, { cfgvalue: (id?: string) => TestNode }>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-13T12:00:00Z'));
  snapshot = { sources: [source('sites'), source('other')], job: null };
  vi.mocked(getGeodataState).mockImplementation(async () => snapshot);
  vi.mocked(updateGeodata).mockResolvedValue({});
  vi.stubGlobal(
    'E',
    (_tag: string, attrs: Record<string, unknown>, children: TestNode[]) =>
      new TestNode(attrs, [children].flat().filter(Boolean)),
  );
  vi.spyOn(ui, 'showModal').mockImplementation((_title, children) => {
    modal = children as unknown as TestNode[];
    return {} as HTMLElement;
  });
  vi.spyOn(ui, 'hideModal').mockImplementation(() => {
    modal[0].isConnected = false;
  });
  options = {};
  const section = {
    option: (_type: unknown, name: string) => {
      const option = {
        value: vi.fn(),
        load: vi.fn(),
        validate: vi.fn(),
        subsection: section,
      };
      options[name] = option as unknown as (typeof options)[string];
      return option;
    },
  };
  createGeodataContent({ section: () => section } as unknown as CBIMap);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function start(id = 'sites') {
  if (id) options._actions.cfgvalue(id).children[0].click();
  else options._geodata_actions.cfgvalue().click();
  await vi.advanceTimersByTimeAsync(0);
}
function close() {
  modal[1].children[0].click();
}

describe('Geodata state after Update', () => {
  it.each([false, true])(
    'refreshes table rows through completion when the progress window is closed: %s',
    async (closeEarly) => {
      const row = options._state.cfgvalue('sites');
      await vi.advanceTimersByTimeAsync(0);
      expect(row.textContent).toBe('Not downloaded');
      await start();
      expect(updateGeodata).toHaveBeenCalledWith('sites');
      snapshot = {
        sources: [source('sites')],
        job: { source: 'sites', phase: 'download', error: '' },
      };
      if (closeEarly) close();
      await vi.advanceTimersByTimeAsync(300);
      expect(row.textContent).toBe('Downloading');
      snapshot = {
        sources: [source('sites', 42)],
        job: { source: '', phase: 'idle', error: '' },
      };
      await vi.advanceTimersByTimeAsync(2000);
      expect(row.textContent).toContain('42 tags');
      expect(row.textContent).toContain(new Date(42000).toLocaleString());
      if (!closeEarly) expect(modal[0].textContent).toBe('Completed');
      const calls = vi.mocked(getGeodataState).mock.calls.length;
      await vi.advanceTimersByTimeAsync(5000);
      expect(getGeodataState).toHaveBeenCalledTimes(calls);
    },
  );

  it('refreshes all source rows after Update all', async () => {
    const sites = options._state.cfgvalue('sites');
    const other = options._state.cfgvalue('other');
    await vi.advanceTimersByTimeAsync(0);
    await start('');
    expect(updateGeodata).toHaveBeenCalledWith('');
    snapshot = {
      sources: [source('sites', 12), source('other', 24)],
      job: { source: '', phase: 'idle', error: '' },
    };
    await vi.advanceTimersByTimeAsync(2300);
    expect(sites.textContent).toContain('12 tags');
    expect(other.textContent).toContain('24 tags');
  });

  it('refreshes a failed source after the progress window is closed', async () => {
    const row = options._state.cfgvalue('sites');
    await vi.advanceTimersByTimeAsync(0);
    await start();
    close();
    snapshot = {
      sources: [source('sites', 0, 'Download failed')],
      job: { source: '', phase: 'error', error: 'sites: Download failed' },
    };
    await vi.advanceTimersByTimeAsync(2300);
    expect(row.textContent).toBe('Download failed');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops polling when both the table and progress window are removed', async () => {
    const row = options._state.cfgvalue('sites');
    await vi.advanceTimersByTimeAsync(0);
    await start();
    close();
    row.isConnected = false;
    const calls = vi.mocked(getGeodataState).mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(getGeodataState).toHaveBeenCalledTimes(calls);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('applies an in-flight status response to the table after closing', async () => {
    const row = options._state.cfgvalue('sites');
    await vi.advanceTimersByTimeAsync(0);
    await start();
    let resolve!: (state: GeodataState) => void;
    vi.mocked(getGeodataState).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    await vi.advanceTimersByTimeAsync(300);
    close();
    snapshot = {
      sources: [source('sites', 18)],
      job: { source: '', phase: 'idle', error: '' },
    };
    resolve(snapshot);
    await vi.advanceTimersByTimeAsync(2000);
    expect(row.textContent).toContain('18 tags');
    expect(vi.getTimerCount()).toBe(0);
  });
});
