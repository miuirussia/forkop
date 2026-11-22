import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureServerVisibility } from '../serverVisibility';

afterEach(() => vi.unstubAllGlobals());

function setup(value?: string) {
  vi.stubGlobal('uci', {
    get: () => value,
    set: (_config: string, _section: string, _option: string, next: string) => {
      value = next;
    },
  });
  vi.stubGlobal('CustomEvent', class extends Event {});
  const rows = [{} as Node];
  const pane = {
    childNodes: rows.slice(),
    replaceChildren(...nodes: Node[]) {
      this.childNodes = nodes;
    },
    dispatchEvent: vi.fn(),
  };
  const parse = vi.fn().mockResolvedValue(undefined);
  const section = {
    renderContents: async () => {
      pane.childNodes = rows.slice();
      return pane;
    },
    parse,
  } as unknown as CBISection;
  const option = {} as CBIOption;
  configureServerVisibility(section, option);
  const change = (enabled: string) =>
    option.onchange!(new Event('change'), 'settings', enabled);
  return { section, pane, parse, rows, change };
}

describe('VPN server visibility', () => {
  it.each([undefined, '0'])(
    'hides servers and preserves their settings when disabled (%s)',
    async (value) => {
      const { section, pane, parse } = setup(value);
      await section.renderContents();
      expect(pane.childNodes).toEqual([]);
      await section.parse();
      expect(parse).not.toHaveBeenCalled();
    },
  );

  it('restores the same rows on enabling and skips parsing on disabling again', async () => {
    const { section, pane, parse, rows, change } = setup();
    await section.renderContents();
    change('1');
    expect(pane.childNodes).toEqual(rows);
    await section.parse();
    expect(parse).toHaveBeenCalledOnce();
    change('0');
    await section.parse();
    expect(parse).toHaveBeenCalledOnce();
    expect(pane.childNodes).toEqual([]);
    change('1');
    expect(pane.childNodes[0]).toBe(rows[0]);
    expect(pane.dispatchEvent).toHaveBeenCalledTimes(3);
  });

  it('shows servers when the saved switch is on', async () => {
    const { section, pane, parse, rows } = setup('1');
    await section.renderContents();
    expect(pane.childNodes).toEqual(rows);
    await section.parse();
    expect(parse).toHaveBeenCalledOnce();
  });

  it.each([
    ['0', '1'],
    ['1', '0'],
  ])(
    'keeps a change from %s to %s when a dialog rerenders the map',
    async (saved, next) => {
      const { section, pane, parse, rows, change } = setup(saved);
      await section.renderContents();
      change(next);
      await section.renderContents();
      expect(pane.childNodes).toEqual(next === '1' ? rows : []);
      await section.parse();
      expect(parse).toHaveBeenCalledTimes(next === '1' ? 1 : 0);
    },
  );
});
