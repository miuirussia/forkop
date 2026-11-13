import { E } from '../../../helpers/element';
import { copyToClipboard } from '../../../helpers/copyToClipboard';
import {
  getGeodataState,
  getGeodataTags,
} from '../../services/geodata.service';

// Only one page of 200 results is mounted. Searching thousands of DAT tags
// never creates thousands of dropdown nodes or a second browser-side catalog.
export async function showGeodataCatalog(
  includeGeoip = true,
  select?: (reference: string) => void,
  sourceId = '',
) {
  const state = await getGeodataState();
  const sources = state.sources.filter(
    (source) => source.ready && (includeGeoip || source.kind === 'geosite'),
  );
  const source = E(
    'select',
    {
      class: 'cbi-input-select',
      'aria-label': _('Geodata source'),
      style: 'flex:1 1 20em;min-width:0;width:100%',
    },
    sources.map((item) =>
      E('option', { value: item.id }, `${item.label} (${item.kind})`),
    ),
  ) as HTMLSelectElement;
  if (sourceId) source.value = sourceId;
  const search = E('input', {
    type: 'text',
    class: 'cbi-input-text',
    style: 'flex:1 1 14em;min-width:0;width:100%;box-sizing:border-box',
    autocomplete: 'off',
    placeholder: _('Search tags'),
    'aria-label': _('Search tags'),
  }) as HTMLInputElement;
  const status = E('p', {
    class: 'fkp-catalog__status',
    role: 'status',
    'aria-live': 'polite',
  });
  const list = E('div', {
    class: 'fkp-catalog__list fkp-catalog__list--counts',
  });
  const previous = E(
    'button',
    { class: 'cbi-button', type: 'button' },
    _('Previous'),
  ) as HTMLButtonElement;
  const next = E(
    'button',
    { class: 'cbi-button', type: 'button' },
    _('Next'),
  ) as HTMLButtonElement;
  let offset = 0;
  let request = 0;
  let timer: ReturnType<typeof setTimeout>;
  let close = () => ui.hideModal();
  const refresh = async () => {
    const current = ++request;
    if (!source.value) {
      status.textContent = _(
        'Add and download a DAT source on the Geodata tab first',
      );
      previous.disabled = next.disabled = true;
      return;
    }
    status.textContent = _('Loading…');
    previous.disabled = next.disabled = true;
    try {
      const response = await getGeodataTags(
        source.value,
        search.value.trim(),
        offset,
      );
      if (current !== request || !list.isConnected) return;
      list.replaceChildren(
        ...response.tags.map((tag) =>
          E('div', { class: 'fkp-catalog__row' }, [
            E('code', { class: 'fkp-catalog__name' }, tag.name),
            E('span', { class: 'fkp-catalog__count' }, String(tag.count)),
            E(
              'button',
              {
                type: 'button',
                class: 'cbi-button cbi-button-add fkp-catalog__action',
                click: () => {
                  if (select) {
                    select(tag.reference);
                    close();
                  } else void copyToClipboard(tag.reference);
                },
              },
              select ? _('Add') : _('Copy reference'),
            ),
          ]),
        ),
      );
      status.textContent = `${response.total ? offset + 1 : 0}–${offset + response.tags.length} / ${response.total}`;
      previous.disabled = offset === 0;
      next.disabled = offset + response.tags.length >= response.total;
    } catch (error) {
      if (current === request)
        status.textContent = String(
          error instanceof Error ? error.message : error,
        );
    }
  };
  search.addEventListener('input', () => {
    offset = 0;
    ++request;
    clearTimeout(timer);
    timer = setTimeout(() => void refresh(), 250);
  });
  source.addEventListener('change', () => {
    offset = 0;
    void refresh();
  });
  previous.addEventListener('click', () => {
    offset = Math.max(0, offset - 200);
    void refresh();
  });
  next.addEventListener('click', () => {
    offset += 200;
    void refresh();
  });
  const content = E('div', { class: 'fkp-catalog' }, [
    E(
      'div',
      { style: 'display:flex;flex-wrap:wrap;gap:.75em;align-items:center' },
      [source, search],
    ),
    status,
    list,
    E('div', { class: 'fkp-catalog__footer' }, [
      previous,
      next,
      E(
        'button',
        {
          type: 'button',
          class: 'cbi-button',
          click: () => {
            ++request;
            clearTimeout(timer);
            close();
          },
        },
        _('Close'),
      ),
    ]),
  ]);
  const modal = select
    ? document.querySelector('#modal_overlay > .modal.cbi-modal')
    : null;
  const active = modal?.querySelector('.cbi-map:not(.hidden)');
  const buttons = modal?.querySelector<HTMLElement>('div.button-row');
  if (active && buttons) {
    active.classList.add('hidden');
    buttons.hidden = true;
    buttons.before(content);
    close = () => {
      ++request;
      clearTimeout(timer);
      content.remove();
      active.classList.remove('hidden');
      buttons.hidden = false;
    };
  } else {
    ui.showModal(_('DAT tags'), [content]);
  }
  void refresh();
}
