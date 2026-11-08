import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DOMAIN_LIST_INCLUDES,
  DOMAIN_LIST_OPTIONS,
} from '../../../../constants';
import { builtinListRefusal, refuseHeldBuiltinLists } from '../ruleSets';

describe('a built-in list picked beside a regional list that holds it', () => {
  it('is refused when a selected regional list already holds it', () => {
    expect(builtinListRefusal(['ru_blocked_rkn'], 'youtube')).toBe(
      'YouTube is already in RU Blocked (RKN)',
    );
    expect(builtinListRefusal(['ru_only', 'ru_blocked_all'], 'chatgpt')).toBe(
      'ChatGPT is already in RU Blocked (All)',
    );
    expect(builtinListRefusal(['ru_blocked_all'], 'ru_blocked_geo')).toBe(
      'RU Blocked (Geo) is already in RU Blocked (All)',
    );
  });

  it('is refused when it would hold lists already selected, naming them', () => {
    expect(builtinListRefusal(['youtube'], 'ru_blocked_rkn')).toBe(
      'YouTube is already in RU Blocked (RKN): remove it first',
    );
    expect(
      builtinListRefusal(['telegram', 'github', 'discord'], 'ru_blocked_all'),
    ).toBe(
      'Telegram, Discord are already in RU Blocked (All): remove them first',
    );
  });

  it('is taken when no selected list holds it and it holds none of them', () => {
    expect(builtinListRefusal(['ru_blocked_rkn'], 'ru_blocked_geo')).toBeNull();
    expect(builtinListRefusal(['ru_blocked_rkn'], 'chatgpt')).toBeNull();
    expect(builtinListRefusal(['ru_blocked_geo'], 'telegram')).toBeNull();
    expect(builtinListRefusal(['ru_blocked_all'], 'github')).toBeNull();
    expect(builtinListRefusal(['github', 'ai'], 'ru_blocked_all')).toBeNull();
    expect(builtinListRefusal([], 'ru_blocked_all')).toBeNull();
  });

  it('names only lists the page offers', () => {
    const offered = Object.keys(DOMAIN_LIST_OPTIONS);
    Object.entries(DOMAIN_LIST_INCLUDES).forEach(([list, held]) => {
      expect(offered).toContain(list);
      held.forEach((value) => expect(offered).toContain(value));
    });
  });
});

// Only the DOM operations the list availability hook uses; LuCI owns the dropdown itself.
function builtinDropdown(selected: string[]) {
  const choices = Object.keys(DOMAIN_LIST_OPTIONS).map((value) => {
    const attributes = new Map([['data-value', value]]);
    let reason: { textContent: string; remove(): void } | null = null;
    return {
      value,
      style: { cursor: '' },
      getAttribute: (name: string) => attributes.get(name) ?? null,
      setAttribute: (name: string, text: string) => attributes.set(name, text),
      toggleAttribute(name: string, enabled: boolean) {
        if (enabled) attributes.set(name, '');
        else attributes.delete(name);
      },
      querySelector: () => reason,
      appendChild(node: { textContent: string }) {
        reason = { ...node, remove: () => (reason = null) };
      },
    };
  });
  const node = Object.assign(new EventTarget(), {
    querySelectorAll: (selector: string) =>
      selector === '.item'
        ? selected.map((value) => {
            const item = {
              querySelector: () => ({ parentNode: item, value }),
            };
            return item;
          })
        : choices,
  });
  vi.stubGlobal('E', (_tag: string, _attrs: unknown, text: string[]) => ({
    textContent: text.join(''),
  }));
  refuseHeldBuiltinLists(node as unknown as HTMLElement);
  return {
    choice: (value: string) => choices.find((item) => item.value === value)!,
    select(...values: string[]) {
      selected.splice(0, selected.length, ...values);
      node.dispatchEvent(new Event('cbi-dynlist-change'));
    },
  };
}

describe('built-in dropdown availability', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('disables included services before a pick and shows the reason', () => {
    const dropdown = builtinDropdown(['ru_blocked_all']);
    const claude = dropdown.choice('claude');
    expect(claude.getAttribute('unselectable')).toBe('');
    expect(claude.getAttribute('aria-disabled')).toBe('true');
    expect(claude.querySelector()?.textContent).toBe(
      'Claude is already in RU Blocked (All)',
    );
    expect(dropdown.choice('github').getAttribute('unselectable')).toBeNull();
  });

  it('updates both directions immediately after additions and removals', () => {
    const dropdown = builtinDropdown([]);
    dropdown.select('claude');
    const regional = dropdown.choice('ru_blocked_all');
    expect(regional.getAttribute('unselectable')).toBe('');
    expect(regional.querySelector()?.textContent).toBe(
      'Claude is already in RU Blocked (All): remove it first',
    );
    expect(dropdown.choice('claude').getAttribute('unselectable')).toBe('');

    dropdown.select('ru_blocked_all');
    expect(regional.querySelector()).toBeNull();
    expect(dropdown.choice('claude').getAttribute('unselectable')).toBe('');
    dropdown.select();
    for (const value of ['claude', 'ru_blocked_all']) {
      const item = dropdown.choice(value);
      expect(item.getAttribute('unselectable')).toBeNull();
      expect(item.getAttribute('aria-disabled')).toBe('false');
      expect(item.querySelector()).toBeNull();
    }
  });
});
