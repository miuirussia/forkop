import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../geodata/catalog', () => ({ showGeodataCatalog: vi.fn() }));
vi.mock('../sagerNetCatalog', () => ({ showSagerNetCatalog: vi.fn() }));

import { showGeodataCatalog } from '../../geodata/catalog';
import { showSagerNetCatalog } from '../sagerNetCatalog';
import { addDatRulesetPicker, addSagerNetRulesetPicker } from '../ruleSets';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('E', (_tag: string, attrs: object) => attrs);
});
afterEach(() => vi.unstubAllGlobals());

describe('rule set pickers', () => {
  it.each([
    ['DAT', addDatRulesetPicker, 'dat:source:cn'],
    [
      'SagerNet',
      addSagerNetRulesetPicker,
      'https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set/geoip-cn.srs',
    ],
  ] as const)(
    '%s preserves existing entries, avoids duplicates and announces the updated list',
    (_name, addPicker, reference) => {
      vi.mocked(showGeodataCatalog).mockImplementation(
        async (_geoip, select) => {
          select?.(reference);
        },
      );
      vi.mocked(showSagerNetCatalog).mockImplementation(
        async (_geoip, select) => {
          select(reference);
        },
      );
      let values = ['/etc/forkop/custom.srs'];
      const widget = {
        getValue: () => values,
        setValue: (next: string[]) => {
          values = next;
        },
      };
      const option = {
        getUIElement: () => widget,
      } as unknown as CBIOption;
      let button!: { click: () => void };
      const node = Object.assign(new EventTarget(), {
        classList: { add: vi.fn() },
        appendChild: (child: typeof button) => {
          button = child;
        },
      });
      const changes: string[][] = [];
      node.addEventListener('cbi-dynlist-change', (event) => {
        expect(event.bubbles).toBe(true);
        changes.push([...values]);
      });

      addPicker(node as unknown as HTMLElement, option, 'route');
      button.click();
      expect(changes).toEqual([['/etc/forkop/custom.srs', reference]]);

      values.push('/etc/forkop/second.srs');
      button.click();
      expect(values).toEqual([
        '/etc/forkop/custom.srs',
        reference,
        '/etc/forkop/second.srs',
      ]);
      expect(changes).toHaveLength(2);
      expect(changes[1]).toEqual(values);
    },
  );
});
