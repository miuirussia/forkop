import { afterEach, describe, expect, it, vi } from 'vitest';

import { groupGeoRulesetChoices } from '../ruleSets';

// The DOM operations the grouping hook needs; LuCI still owns values and selection.
class Item {
  children: Item[] = [];
  parent: Item | null = null;
  classes = new Set<string>();
  classList = {
    add: (value: string) => this.classes.add(value),
    remove: (value: string) => this.classes.delete(value),
  };
  listeners = new Map<string, (event: ReturnType<typeof keyEvent>) => void>();
  constructor(public attrs: Record<string, string> = {}) {}
  getAttribute(name: string) {
    return this.attrs[name] ?? null;
  }
  hasAttribute(name: string) {
    return name in this.attrs;
  }
  setAttribute(name: string, value: string) {
    this.attrs[name] = value;
  }
  addEventListener(
    name: string,
    listener: (event: ReturnType<typeof keyEvent>) => void,
  ) {
    this.listeners.set(name, listener);
  }
  closest(selector: string) {
    return selector === 'li' ? this : null;
  }
  focus() {
    Object.assign(document, { activeElement: this });
  }
  querySelectorAll(selector: string) {
    return this.children.filter((item) =>
      selector === '.focus'
        ? item.classes.has('focus')
        : item.hasAttribute('data-value'),
    );
  }
  insertBefore(item: Item, before: Item | null) {
    item.remove();
    this.children.splice(
      before ? this.children.indexOf(before) : this.children.length,
      0,
      item,
    );
    item.parent = this;
  }
  remove() {
    if (this.parent)
      this.parent.children = this.parent.children.filter(
        (item) => item !== this,
      );
    this.parent = null;
  }
  get nextElementSibling(): Item | null {
    return (
      this.parent?.children[this.parent.children.indexOf(this) + 1] ?? null
    );
  }
  toggleAttribute(name: string, enabled: boolean) {
    if (enabled) this.attrs[name] = '';
    else delete this.attrs[name];
  }
}

function keyEvent(key = '', target = new Item()) {
  return {
    key,
    target,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  };
}

function grouped(files: string[]) {
  const list = new Item();
  list.children = [
    new Item({ placeholder: '' }),
    ...files.map(
      (file) =>
        new Item({
          'data-value': `https://raw.githubusercontent.com/SagerNet/sing-${file.startsWith('geoip-') ? 'geoip' : 'geosite'}/rule-set/${file}`,
        }),
    ),
    new Item({ 'data-value': '-' }),
  ];
  list.children.forEach((item) => {
    item.parent = list;
  });
  const dropdown = Object.assign(new Item({ open: '' }), {
    querySelector: () => list,
  });
  const selected: string[] = [];
  const node = {
    querySelector: () => dropdown,
    querySelectorAll: () =>
      selected.map((value) => {
        const item = { querySelector: () => ({ parentNode: item, value }) };
        return item;
      }),
  };
  vi.stubGlobal('document', { activeElement: dropdown });
  vi.stubGlobal(
    'E',
    (_tag: string, attrs: Record<string, string>, children: unknown[]) =>
      Object.assign(new Item(attrs), { children }),
  );
  groupGeoRulesetChoices(node as unknown as HTMLElement);
  return {
    list,
    dropdown,
    selected,
    headings: list.children.filter((item) => item.attrs.role === 'button'),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('rule set catalog sections', () => {
  it('starts collapsed, shows counts and expands only the clicked catalog', () => {
    const { list, headings } = grouped([
      'geosite-youtube.srs',
      'geosite-google.srs',
      'geoip-ru.srs',
    ]);
    expect(headings.map((item) => item.attrs['aria-label'])).toEqual([
      'geosite (2)',
      'geoip (1)',
    ]);
    expect(headings.every((item) => !item.hasAttribute('data-value'))).toBe(
      true,
    );
    expect(
      list.children.filter((item) =>
        item.attrs['data-value']?.endsWith('.srs'),
      ),
    ).toHaveLength(0);
    const click = keyEvent();
    headings[1].listeners.get('click')!(click);
    expect(click.stopPropagation).toHaveBeenCalledOnce();
    expect(headings[1].attrs['aria-expanded']).toBe('true');
    expect(
      list.children.filter((item) =>
        item.attrs['data-value']?.endsWith('.srs'),
      ),
    ).toHaveLength(1);
    headings[1].listeners.get('click')!(keyEvent());
    expect(
      list.children.filter((item) =>
        item.attrs['data-value']?.endsWith('.srs'),
      ),
    ).toHaveLength(0);
  });

  it('expands using Enter or Space and lets the keyboard reach the choices', () => {
    const { headings } = grouped(['geosite-youtube.srs']);
    expect(headings).toHaveLength(1);
    headings[0].focus();
    const enter = keyEvent('Enter');
    headings[0].listeners.get('keydown')!(enter);
    expect(enter.preventDefault).toHaveBeenCalledOnce();
    expect(headings[0].attrs['aria-expanded']).toBe('true');
    expect(headings[0].nextElementSibling?.attrs['data-value']).toContain(
      'geosite-youtube.srs',
    );
    expect(headings[0].nextElementSibling?.attrs.tabindex).toBe('0');
    headings[0].listeners.get('keydown')!(keyEvent(' '));
    expect(headings[0].attrs['aria-expanded']).toBe('false');
  });

  it('keeps manual input as the last menu entry when sections expand and collapse', () => {
    const { list, headings } = grouped(['geosite-youtube.srs', 'geoip-ru.srs']);
    for (const heading of headings) heading.listeners.get('click')!(keyEvent());
    expect(list.children[list.children.length - 1]?.attrs['data-value']).toBe(
      '-',
    );
    expect(
      list.children.filter((item) =>
        item.attrs['data-value']?.endsWith('.srs'),
      ),
    ).toHaveLength(2);
    headings[0].listeners.get('click')!(keyEvent());
    expect(list.children[list.children.length - 1]?.attrs['data-value']).toBe(
      '-',
    );
    expect(headings[0].nextElementSibling).toBe(headings[1]);
  });

  it('updates availability after a selection is removed while its section is collapsed', () => {
    const { list, headings, selected } = grouped(['geosite-youtube.srs']);
    selected.push(
      'https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-youtube.srs',
    );
    headings[0].listeners.get('click')!(keyEvent());
    const choice = list.children.find(
      (item) => item.attrs['data-value'] === selected[0],
    )!;
    expect(choice.hasAttribute('unselectable')).toBe(true);
    headings[0].listeners.get('click')!(keyEvent());
    selected.length = 0;
    headings[0].listeners.get('click')!(keyEvent());
    expect(choice.hasAttribute('unselectable')).toBe(false);
  });
});
