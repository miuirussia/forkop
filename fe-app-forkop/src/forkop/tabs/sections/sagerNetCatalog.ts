import { E } from '../../../helpers/element';
import {
  loadSingGeositeFiles,
  loadSingGeoipFiles,
  SING_GEOSITE_URL,
  SING_GEOIP_URL,
} from '../../services/singGeo.service';

const PAGE_SIZE = 200;

export async function showSagerNetCatalog(
  includeGeoip: boolean,
  select: (reference: string) => void,
  selected: () => string[],
) {
  const source = E(
    'select',
    {
      class: 'cbi-input-select',
      'aria-label': _('Rule set type'),
      style: 'flex:1 1 10em;min-width:0;width:100%',
    },
    [
      E('option', { value: 'geosite' }, 'geosite'),
      ...(includeGeoip ? [E('option', { value: 'geoip' }, 'geoip')] : []),
    ],
  ) as HTMLSelectElement;
  const search = E('input', {
    type: 'text',
    role: 'searchbox',
    class: 'cbi-input-text',
    style: 'flex:2 1 14em;min-width:0;width:100%;box-sizing:border-box',
    autocomplete: 'off',
    placeholder: _('Search rule sets'),
    'aria-label': _('Search rule sets'),
  }) as HTMLInputElement;
  const status = E(
    'p',
    {
      class: 'fkp-catalog__status',
      role: 'status',
      'aria-live': 'polite',
    },
    _('Loading…'),
  );
  const list = E('div', { class: 'fkp-catalog__list' });
  const previous = E(
    'button',
    { class: 'cbi-button', type: 'button', disabled: true },
    _('Previous'),
  ) as HTMLButtonElement;
  const next = E(
    'button',
    { class: 'cbi-button', type: 'button', disabled: true },
    _('Next'),
  ) as HTMLButtonElement;
  let catalogs: Record<string, string[]> | null = null;
  let offset = 0;
  let closed = false;
  let restore = () => ui.hideModal();
  const opener = document.activeElement as HTMLElement | null;
  const close = () => {
    closed = true;
    restore();
    opener?.focus();
  };
  const refresh = () => {
    if (!catalogs || closed) return;
    const kind = source.value;
    const query = search.value.trim().toLowerCase();
    const files = (catalogs[kind] ?? []).filter((file) =>
      file
        .slice(kind.length + 1, -4)
        .toLowerCase()
        .includes(query),
    );
    const url = kind === 'geoip' ? SING_GEOIP_URL : SING_GEOSITE_URL;
    const selectedRefs = new Set(selected());
    const page = files.slice(offset, offset + PAGE_SIZE);
    list.replaceChildren(
      ...page.map((file) => {
        const reference = url + file;
        const added = selectedRefs.has(reference);
        return E('div', { class: 'fkp-catalog__row' }, [
          E(
            'span',
            {
              class: 'fkp-catalog__name',
              title: reference,
            },
            file.slice(kind.length + 1, -4),
          ),
          E(
            'button',
            {
              type: 'button',
              class: 'cbi-button cbi-button-add fkp-catalog__action',
              disabled: added ? '' : null,
              'aria-label': added
                ? _('Selected: %s').format(file.slice(kind.length + 1, -4))
                : _('Add %s').format(file.slice(kind.length + 1, -4)),
              click: () => {
                select(reference);
                close();
              },
            },
            added ? _('Selected') : _('Add'),
          ),
        ]);
      }),
    );
    status.textContent = files.length
      ? `${offset + 1}–${offset + page.length} / ${files.length}`
      : catalogs[kind]?.length
        ? _('No matching rule sets')
        : _('Could not load the SagerNet catalog. Close and try again');
    previous.disabled = offset === 0;
    next.disabled = offset + PAGE_SIZE >= files.length;
    list.scrollTop = 0;
  };
  search.addEventListener('input', () => {
    offset = 0;
    refresh();
  });
  source.addEventListener('change', () => {
    offset = 0;
    refresh();
  });
  previous.addEventListener('click', () => {
    offset = Math.max(0, offset - PAGE_SIZE);
    refresh();
  });
  next.addEventListener('click', () => {
    offset += PAGE_SIZE;
    refresh();
  });
  const content = E('div', { class: 'fkp-catalog fkp-sagernet-catalog' }, [
    E('h4', {}, _('Choose SagerNet rule-set')),
    E(
      'div',
      { style: 'display:flex;flex-wrap:wrap;gap:.75em;align-items:center' },
      [source, search],
    ),
    status,
    list,
    E(
      'div',
      {
        class: 'fkp-catalog__footer',
      },
      [
        previous,
        next,
        E(
          'button',
          { type: 'button', class: 'cbi-button', click: close },
          _('Close'),
        ),
      ],
    ),
  ]);
  content.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    close();
  });
  const modal = document.querySelector('#modal_overlay > .modal.cbi-modal');
  const active = modal?.querySelector('.cbi-map:not(.hidden)');
  const buttons = modal?.querySelector<HTMLElement>('div.button-row');
  if (active && buttons) {
    active.classList.add('hidden');
    buttons.hidden = true;
    buttons.before(content);
    restore = () => {
      content.remove();
      active.classList.remove('hidden');
      buttons.hidden = false;
    };
  } else {
    ui.showModal(_('Choose SagerNet rule-set'), [content]);
  }
  search.focus();
  const [geosite, geoip] = await Promise.all([
    loadSingGeositeFiles(),
    includeGeoip ? loadSingGeoipFiles() : Promise.resolve([]),
  ]);
  catalogs = { geosite, geoip };
  refresh();
}
