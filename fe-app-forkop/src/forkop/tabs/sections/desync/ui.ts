import { E } from '../../../../helpers/element';

export function desyncField(label: string, control: HTMLElement) {
  return E('label', { class: 'fkp-desync__field' }, [
    E('span', {}, label),
    control,
  ]);
}

export function desyncGroup(label: string, children: HTMLElement[]) {
  return E('section', { class: 'fkp-desync__group' }, [
    E('h4', { class: 'fkp-desync__heading' }, label),
    E('div', { class: 'fkp-desync__body' }, children),
  ]);
}

export function desyncPanel(label: string, children: HTMLElement[]) {
  return E('details', { class: 'fkp-desync__panel' }, [
    E('summary', {}, [
      E('span', { class: 'fkp-desync__title' }, label),
      E(
        'span',
        { class: 'btn cbi-button fkp-desync__toggle', 'aria-hidden': 'true' },
        [
          E('span', { class: 'fkp-desync__show' }, _('Show')),
          E('span', { class: 'fkp-desync__hide' }, _('Hide')),
        ],
      ),
    ]),
    E('div', { class: 'fkp-desync__body' }, children),
  ]);
}

export function desyncActions(children: HTMLElement[]) {
  return E('div', { class: 'fkp-desync__actions' }, children);
}

export function desyncTabs(
  id: string,
  tabs: Array<{ key: string; label: string; content: HTMLElement }>,
) {
  const panes = tabs.map(({ key, content }) =>
    E(
      'div',
      {
        id: `${id}-${key}-pane`,
        role: 'tabpanel',
        'aria-labelledby': `${id}-${key}-tab`,
      },
      content,
    ),
  );
  const links = tabs.map(({ key, label }, index) =>
    E(
      'a',
      {
        id: `${id}-${key}-tab`,
        href: `#${id}-${key}-pane`,
        role: 'tab',
        'aria-controls': `${id}-${key}-pane`,
        click: (event: MouseEvent) => {
          event.preventDefault();
          select(index);
        },
        keydown: (event: KeyboardEvent) => {
          const next =
            event.key === 'ArrowRight'
              ? (index + 1) % tabs.length
              : event.key === 'ArrowLeft'
                ? (index + tabs.length - 1) % tabs.length
                : event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? tabs.length - 1
                    : undefined;
          if (next === undefined) return;
          event.preventDefault();
          select(next);
          links[next].focus();
        },
      },
      label,
    ),
  );
  const items = links.map((link) => E('li', { role: 'presentation' }, link));
  function select(index: number) {
    links.forEach((link, i) => {
      link.setAttribute('aria-selected', String(i === index));
      link.setAttribute('tabindex', i === index ? '0' : '-1');
      items[i].setAttribute(
        'class',
        i === index ? 'cbi-tab' : 'cbi-tab-disabled',
      );
      panes[i].hidden = i !== index;
    });
  }
  select(0);
  return E('div', { class: 'fkp-desync__tabs' }, [
    E(
      'ul',
      { class: 'cbi-tabmenu', role: 'tablist', 'aria-label': _('Desync') },
      items,
    ),
    ...panes,
  ]);
}
