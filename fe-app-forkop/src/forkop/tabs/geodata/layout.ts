import { E } from '../../../helpers/element';

function renderGroup(
  id: string,
  title: string,
  content: HTMLElement[],
  actions: HTMLElement[] = [],
) {
  const group = E('section', {}, [
    E('header', { class: 'fkp-geodata__heading' }, [
      E('h4', { id }, title),
      E('div', { class: 'fkp-geodata__actions' }, actions),
    ]),
    E('div', { class: 'cbi-section-node fkp-geodata__panel' }, content),
  ]);
  group.setAttribute('aria-labelledby', id);
  return group;
}

export function arrangeGeodataGroups(section: CBISection) {
  const renderContents = section.renderContents;
  section.renderContents = async function (...args) {
    const node = (await renderContents.apply(this, args)) as HTMLElement;
    const body = node.querySelector<HTMLElement>(':scope > .cbi-section-node');
    if (!body) return node;

    const fields = new Map(
      Array.from(
        body.querySelectorAll<HTMLElement>(':scope > [data-name]'),
        (field) => [field.dataset.name, field] as const,
      ),
    );
    const sources = fields.get('_dat_sources');
    const storage = fields.get('geodata_path');
    const datRoute = fields.get('geodata_download_section');
    const datAction = fields.get('_geodata_actions');
    const listAction = fields.get('_list_update_action');
    const updateDat = datAction?.querySelector<HTMLElement>('button');
    const updateLists = listAction?.querySelector<HTMLElement>(
      '.fkp-geodata__list-action',
    );
    if (!sources || !storage || !datRoute || !updateDat || !updateLists)
      return node;

    const addSource = sources.querySelector<HTMLElement>(
      '.cbi-section-create > button',
    );
    const applyHint = E(
      'p',
      { class: 'cbi-value-description' },
      _('Save & Apply before downloading newly added or changed sources'),
    );
    const listSettings = [...fields.values()].filter(
      (field) =>
        field !== sources &&
        field !== storage &&
        field !== datRoute &&
        field !== datAction &&
        field !== listAction,
    );

    body.classList.replace('cbi-section-node', 'fkp-geodata');
    body.replaceChildren(
      renderGroup(
        'fkp-geodata-sources',
        _('DAT sources'),
        [sources, applyHint],
        addSource ? [updateDat, addSource] : [updateDat],
      ),
      renderGroup('fkp-geodata-settings', _('DAT settings'), [
        storage,
        datRoute,
      ]),
      renderGroup('fkp-geodata-lists', _('Lists and rule sets'), listSettings, [
        updateLists,
      ]),
    );
    return node;
  };
}
