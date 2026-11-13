import { E } from '../../../helpers/element';
import { showToast } from '../../../helpers/showToast';
import { prettyBytes } from '../../../helpers/prettyBytes';
import { validatePath } from '../../../validators/validatePath';
import { validateUrl } from '../../../validators/validateUrl';
import { nextSectionId } from '../../cbi/childItems';
import {
  type GeodataState,
  getGeodataState,
  updateGeodata,
  validateGeodataInterval,
} from '../../services/geodata.service';
import { configureDownloadSectionOption } from '../settings/sectionChoices';
import { addRuleSetUpdateOptions } from '../settings/form/updates';
import { showGeodataCatalog } from './catalog';

const phases: Record<string, () => string> = {
  queued: () => _('Starting…'),
  download: () => _('Downloading'),
  validate: () => _('Validating'),
  compile: () => _('Compiling rule sets'),
  idle: () => _('Completed'),
  error: () => _('Failed'),
};

function renderSourceState(text: HTMLElement, id: string, state: GeodataState) {
  const source = state.sources.find((item) => item.id === id);
  const job = state.job;
  text.textContent =
    job?.source === id && job.phase !== 'idle' && job.phase !== 'error'
      ? phases[job.phase]?.() || job.phase
      : source?.error ||
        (source?.ready
          ? `${prettyBytes(source.size)} · ${source.tag_count} ${_('tags')} · ${new Date(source.updated_at * 1000).toLocaleString()}`
          : _('Not downloaded'));
}

async function startUpdate(id: string, rows: Map<HTMLElement, string>) {
  try {
    await updateGeodata(id);
    const status = E(
      'p',
      { role: 'status', 'aria-live': 'polite' },
      _('Starting…'),
    );
    let closed = false;
    ui.showModal(_('Update geodata'), [
      status,
      E(
        'div',
        { class: 'right' },
        E(
          'button',
          {
            type: 'button',
            class: 'cbi-button',
            click: () => {
              closed = true;
              ui.hideModal();
            },
          },
          _('Close'),
        ),
      ),
    ]);
    const started = Date.now();
    const poll = async () => {
      if (
        (closed || !status.isConnected) &&
        !Array.from(rows.keys()).some((text) => text.isConnected)
      )
        return;
      try {
        const state = await getGeodataState();
        for (const [text, sourceId] of rows) {
          if (text.isConnected) renderSourceState(text, sourceId, state);
          else rows.delete(text);
        }
        const job = state.job;
        if (!closed && status.isConnected)
          status.textContent =
            job?.error ||
            (job
              ? `${job.source ? `${job.source}: ` : ''}${phases[job.phase]?.() || job.phase}`
              : _('Starting…'));
        if (
          job &&
          (job.phase === 'error' || job.phase === 'idle') &&
          Date.now() - started > 1500
        )
          return;
        setTimeout(() => void poll(), 1000);
      } catch (error) {
        status.textContent = String(
          error instanceof Error ? error.message : error,
        );
      }
    };
    setTimeout(() => void poll(), 300);
  } catch (error) {
    showToast(String(error instanceof Error ? error.message : error), 'error');
  }
}

export function createGeodataContent(map: CBIMap) {
  const stateRows = new Map<HTMLElement, string>();
  const section = map.section(
    form.TypedSection,
    'geodata_settings',
    _('Geodata'),
  );
  section.anonymous = true;
  section.addremove = false;
  section.cfgsections = () => ['settings'];
  let o = section.option(
    form.Value,
    'geodata_path',
    _('Geodata storage directory'),
    _(
      '/tmp uses RAM and is cleared on reboot. Use external storage for large DAT files. An update temporarily needs space for both versions',
    ),
  );
  o.value('/tmp/forkop-geodata', 'RAM (/tmp/forkop-geodata)');
  o.value('/usr/share/forkop-geodata', 'Flash (/usr/share/forkop-geodata)');
  o.default = '/tmp/forkop-geodata';
  o.rmempty = false;
  o.validate = (_id, value) =>
    value === '/' || /(^|\/)\.\.?($|\/)/.test(value)
      ? _('Choose a dedicated absolute directory')
      : validatePath(value);
  o = section.option(
    form.ListValue,
    'geodata_download_section',
    _('Download DAT through'),
  );
  configureDownloadSectionOption(o, 'geodata_download_section');
  o.rmempty = true;
  const validate = o.validate;
  o.validate = function (id: string, value: string) {
    return value === '' ? true : validate.call(this, id, value);
  };
  const load = o.load;
  o.load = function (id: string) {
    const value = load.call(this, id);
    this.value('', _('Directly'));
    return value;
  };
  o = section.option(
    form.DummyValue,
    '_geodata_actions',
    '',
    _('Save & Apply before downloading newly added or changed sources'),
  );
  o.cfgvalue = () =>
    E(
      'button',
      {
        type: 'button',
        class: 'cbi-button cbi-button-action',
        click: () => void startUpdate('', stateRows),
      },
      _('Update all DAT sources'),
    );

  const holder = section.option(
    form.SectionValue,
    '_dat_sources',
    form.GridSection,
    'geodata',
    _('DAT sources'),
  );
  const grid = holder.subsection!;
  grid.anonymous = true;
  grid.addremove = true;
  grid.sortable = false;
  grid.nodescriptions = true;
  grid.handleAdd = function (event: Event) {
    return form.GridSection.prototype.handleAdd.call(
      this,
      event,
      nextSectionId('geodata'),
    );
  };
  grid.modaltitle = _('DAT source');
  o = grid.option(form.Value, 'label', _('Name'));
  o.rmempty = false;
  o = grid.option(form.ListValue, 'kind', _('Type'));
  o.value('geosite', 'Geosite');
  o.value('geoip', 'GeoIP');
  o.default = 'geosite';
  o.rmempty = false;
  o = grid.option(form.Value, 'input', _('DAT URL or local path'));
  o.rmempty = false;
  o.validate = (_id, value) =>
    /^https?:\/\//.test(value) ? validateUrl(value) : validatePath(value);
  o = grid.option(form.Flag, 'auto_update', _('Auto update'));
  o.default = '1';
  o.rmempty = false;
  o = grid.option(form.Value, 'update_interval', _('Update interval'));
  o.default = '1d';
  o.rmempty = false;
  o.modalonly = true;
  o.validate = (_id, value) => validateGeodataInterval(value);
  o = grid.option(form.DummyValue, '_state', _('State'));
  o.cfgvalue = function (id: string) {
    const text = E('span', {}, _('Loading…'));
    stateRows.set(text, id);
    void getGeodataState()
      .then((state) => {
        renderSourceState(text, id, state);
      })
      .catch(() => {
        text.textContent = _('Unavailable');
      });
    return text;
  };
  o.textvalue = o.cfgvalue;
  o = grid.option(form.DummyValue, '_actions', _('Actions'));
  o.cfgvalue = (id: string) =>
    E('div', {}, [
      E(
        'button',
        {
          type: 'button',
          class: 'cbi-button cbi-button-action',
          click: () => void startUpdate(id, stateRows),
        },
        _('Update'),
      ),
      E(
        'button',
        {
          type: 'button',
          class: 'cbi-button',
          click: () =>
            void showGeodataCatalog(true, undefined, id).catch((error: Error) =>
              showToast(error.message, 'error'),
            ),
        },
        _('Tags'),
      ),
    ]);
  o.textvalue = o.cfgvalue;
  const remove = grid.handleRemove;
  grid.handleRemove = function (id: string, event: Event) {
    const sections = uci.sections('forkop', 'section') || [];
    if (
      sections.some((item) =>
        ['rule_set', 'rule_set_with_subnets'].some((key) => {
          const value = item[key];
          return (Array.isArray(value) ? value : value ? [value] : []).some(
            (reference) => String(reference).startsWith(`dat:${id}:`),
          );
        }),
      )
    ) {
      showToast(
        _('Remove this source from routing and DNS rules first'),
        'error',
      );
      return;
    }
    return remove?.call(this, id, event);
  };
  addRuleSetUpdateOptions(section);
}
