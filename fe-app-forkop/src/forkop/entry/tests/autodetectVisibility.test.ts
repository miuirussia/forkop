import { afterEach, expect, it, vi } from 'vitest';
import { configureAutodetectVisibility } from '../autodetectVisibility';

afterEach(() => vi.unstubAllGlobals());

it('hides Autodetect by default, restores it when enabled, and keeps staged changes across renders', async () => {
  let value: unknown;
  vi.stubGlobal('uci', {
    get: () => value,
    set: (_pkg: string, _id: string, _key: string, next: unknown) => {
      value = next;
    },
  });
  vi.stubGlobal('CustomEvent', class extends Event {});
  const contents = [{} as Node];
  const pane = {
    childNodes: contents.slice(),
    replaceChildren(...nodes: Node[]) {
      this.childNodes = nodes;
    },
    dispatchEvent: vi.fn(),
  };
  const section = {
    renderContents: async () => {
      pane.childNodes = contents.slice();
      return pane;
    },
  } as unknown as CBISection;
  const option = {} as CBIOption;
  configureAutodetectVisibility(section, option);
  await section.renderContents();
  expect(pane.childNodes).toEqual([]);
  option.onchange!(new Event('change'), 'settings', '1');
  expect(pane.childNodes).toEqual(contents);
  await section.renderContents();
  expect(pane.childNodes[0]).toBe(contents[0]);
  option.onchange!(new Event('change'), 'settings', '0');
  expect(pane.childNodes).toEqual([]);
  expect(pane.dispatchEvent).toHaveBeenCalledTimes(2);
});
