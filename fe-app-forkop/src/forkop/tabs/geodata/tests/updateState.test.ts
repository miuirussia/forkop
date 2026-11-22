import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Forkop } from '../../../types';

vi.mock('../../../../helpers/showToast', () => ({ showToast: vi.fn() }));
vi.mock('../../../methods/custom/clashApi', () => ({
  setClashApiConfigSections: vi.fn(),
  updateClashApiRuleProviders: vi.fn(),
}));
vi.mock('../../../methods/custom/getConfigSections', () => ({
  getConfigSections: vi.fn(),
}));

vi.mock('../../../services/geodata.service', () => ({
  getGeodataState: vi.fn(),
  updateGeodata: vi.fn(),
  validateGeodataInterval: vi.fn(),
}));
vi.mock('../../settings/sectionChoices', () => ({
  configureDirectDownloadSectionOption: vi.fn(),
}));
vi.mock('../../settings/form/updates', () => ({
  addRuleSetUpdateOptions: vi.fn(),
}));

import {
  type GeodataState,
  getGeodataState,
  updateGeodata,
} from '../../../services/geodata.service';
import { logger } from '../../../services/logger.service';
import { showToast } from '../../../../helpers/showToast';
import {
  setClashApiConfigSections,
  updateClashApiRuleProviders,
} from '../../../methods/custom/clashApi';
import { getConfigSections } from '../../../methods/custom/getConfigSections';
import { createGeodataContent } from '../index';

class TestNode {
  isConnected = true;
  disabled = false;
  classList = { add: vi.fn(), remove: vi.fn() };
  textContent = '';
  constructor(
    public attrs: Record<string, unknown>,
    public children: TestNode[],
  ) {}
  appendChild(child: TestNode) {
    this.children.push(child);
  }
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
let options: Record<
  string,
  { cfgvalue: (id?: string) => TestNode; renderWidget: () => TestNode }
>;

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

describe('Update lists on Geodata', () => {
  function rule(options: Partial<Forkop.ConfigSection>): Forkop.ConfigSection {
    return { '.type': 'section', '.name': 'rule', ...options };
  }

  async function listAction(sections: Forkop.ConfigSection[]) {
    vi.mocked(getConfigSections).mockResolvedValue(sections);
    const node = options._list_update_action.renderWidget();
    await vi.advanceTimersByTimeAsync(0);
    return node.children[0];
  }

  it.each([
    ['no lists', [rule({})], false],
    [
      'built-in lists',
      [rule({ action: 'bypass', community_lists: ['youtube'] })],
      true,
    ],
    [
      'remote rule sets',
      [rule({ action: 'block', rule_set: ['https://example.com/ads.srs'] })],
      true,
    ],
    [
      'remote subnet lists',
      [rule({ rule_set_with_subnets: ['https://example.com/mixed.txt'] })],
      true,
    ],
    ['built-in rule set references', [rule({ rule_set: ['youtube'] })], true],
    ['local rule sets', [rule({ rule_set: ['/etc/forkop/local.srs'] })], false],
    [
      'DAT rule sets',
      [
        rule({
          rule_set: ['dat:sites:ru'],
          rule_set_with_subnets: ['dat:ips:ru'],
        }),
      ],
      false,
    ],
    [
      'disabled sections',
      [rule({ enabled: '0', community_lists: ['telegram'] })],
      false,
    ],
  ] as const)(
    'handles visibility for %s',
    async (_label, sections, expected) => {
      expect(Boolean(await listAction([...sections]))).toBe(expected);
    },
  );

  it('updates all lists once and keeps the action busy across form renders', async () => {
    type Result = Awaited<ReturnType<typeof updateClashApiRuleProviders>>;
    let finish!: (result: Result) => void;
    vi.mocked(updateClashApiRuleProviders).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const sections = [rule({ community_lists: ['youtube'] })];
    const button = await listAction(sections);
    expect(button.children).toEqual(['Update lists']);
    const applied = [
      ...sections,
      { '.type': 'settings', '.name': 'settings', yacd_secret_key: 'new-key' },
    ] satisfies Forkop.ConfigSection[];
    vi.mocked(getConfigSections).mockResolvedValueOnce(applied);
    button.click();
    expect(button.disabled).toBe(true);

    const rerendered = await listAction(sections);
    expect(rerendered.disabled).toBe(true);
    rerendered.click();
    expect(setClashApiConfigSections).toHaveBeenCalledExactlyOnceWith(applied);
    expect(updateClashApiRuleProviders).toHaveBeenCalledOnce();
    expect(updateClashApiRuleProviders).toHaveBeenCalledWith();

    finish({ success: true, data: undefined });
    await vi.advanceTimersByTimeAsync(0);
    expect(showToast).toHaveBeenCalledWith('Lists updated', 'success');
    expect(rerendered.disabled).toBe(false);
  });

  it('reports a failed update and re-enables the button', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.mocked(updateClashApiRuleProviders).mockResolvedValue({
      success: false,
      error: 'update 1 of 3 rule-sets failed',
    });
    const button = await listAction([rule({ community_lists: ['youtube'] })]);
    button.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(showToast).toHaveBeenCalledWith('Failed to update lists', 'error');
    expect(button.disabled).toBe(false);
  });
});
