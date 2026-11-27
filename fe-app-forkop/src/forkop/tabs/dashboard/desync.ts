import { E } from '../../../helpers/element';
import { desyncApi } from '../sections/desync/api';
import { renderDesyncDiagnostics } from '../sections/desync/diagnostics';
import { desyncActions, desyncPanel } from '../sections/desync/ui';

export function showDesyncDetailsModal(section: string, name: string) {
  const error = E('p', { role: 'alert', class: 'fkp-desync__error' });
  const status = E('p', { role: 'status' });
  const learning = E('div');
  const json = E('pre', {
    class: 'fkp-desync__result-json',
    tabindex: 0,
    'aria-label': _('Raw diagnostics JSON'),
  });
  const raw = desyncPanel(_('Raw diagnostics JSON'), [json]);
  raw.hidden = true;
  // Errors and expanded JSON share the results budget, leaving actions visible.
  const results = E(
    'div',
    {
      class: 'fkp-desync__learning',
      tabindex: 0,
      role: 'region',
      'aria-label': _('Desync details'),
    },
    [error, status, learning, raw],
  );
  let pending = false;

  const refresh = E(
    'button',
    {
      type: 'button',
      class: 'btn cbi-button',
      click: () => void load(),
    },
    _('Refresh diagnostics'),
  );
  const clear = E(
    'button',
    {
      type: 'button',
      class: 'btn cbi-button',
      click: () => void load(true),
    },
    _('Clear learning results'),
  );

  async function load(clearLearning = false) {
    if (pending) return;
    pending = true;
    refresh.disabled = clear.disabled = true;
    error.textContent = '';
    status.textContent = _('Loading…');
    try {
      if (clearLearning) await desyncApi.clear(section);
      const snapshot = await desyncApi.diagnostics(section);
      learning.replaceChildren(renderDesyncDiagnostics(snapshot));
      json.textContent = JSON.stringify(snapshot, null, 2);
      raw.hidden = false;
      status.textContent = clearLearning ? _('Learning results cleared') : '';
    } catch (reason) {
      error.textContent =
        reason instanceof Error ? reason.message : String(reason);
      status.textContent = '';
    } finally {
      pending = false;
      refresh.disabled = clear.disabled = false;
    }
  }

  ui.showModal(
    `${_('Desync details')}: ${name}`,
    E(
      'div',
      { class: 'fkp_dashboard-page__urltest-details' },
      E('div', { class: 'fkp-desync' }, [
        E(
          'p',
          {},
          _('Current strategy, switch reason and learning statistics'),
        ),
        desyncActions([refresh, clear]),
        results,
        E('div', { class: 'fkp_dashboard-page__urltest-details__footer' }, [
          E(
            'button',
            {
              type: 'button',
              class: 'btn cbi-button cbi-button-neutral',
              click: () => ui.hideModal(),
            },
            _('Close'),
          ),
        ]),
      ]),
    ),
    'fkp-desync-modal',
  );
  void load();
}
