import { E } from '../../../helpers/element';
import { onMount } from '../../../helpers/onMount';
import { isActiveLuciTab } from '../../helpers/isActiveLuciTab';
import { createPollChain } from '../../helpers/pollChain';
import { getClashApiAutodetect } from '../../methods/custom/clashApi';
import type { AutodetectProbe, AutodetectResult } from './types';

const verdicts = {
  blocked: () => _('Likely blocked'),
  restricted: () => _('HTTP restriction'),
  accessible: () => _('Direct HTTPS responds'),
  inconclusive: () => _('Inconclusive'),
};

export function probeDescription(probe: AutodetectProbe): string {
  const stages: Record<string, string> = {
    tcp: 'TCP / DNS',
    tls: 'TLS',
    http: 'HTTP',
    body: _('Response transfer'),
  };
  if (probe.error) {
    return `${probe.status ? `HTTP ${probe.status} · ` : ''}${stages[probe.stage] || probe.stage}: ${probe.error}`;
  }
  if (probe.status)
    return `HTTP ${probe.status} · ${probe.duration_ms} ${_('ms')}`;
  return `${stages[probe.stage] || probe.stage}: ${probe.error || _('No response')}`;
}

function renderResult(result: AutodetectResult) {
  const signals = {
    no_reply: _('No reply'),
    early_close: _('Connection closed early'),
    stalled: _('Transfer stalled'),
  };
  return E('tr', { class: 'tr' }, [
    E('td', { class: 'td' }, [
      E('strong', {}, result.domain),
      E('div', {}, result.target),
      E('div', { class: 'fkp-autodetect__source' }, result.source),
    ]),
    E('td', { class: 'td' }, [
      E('strong', {}, verdicts[result.verdict]?.() || _('Inconclusive')),
      E('div', {}, signals[result.signal] || ''),
    ]),
    E('td', { class: 'td' }, probeDescription(result.direct)),
    E('td', { class: 'td' }, probeDescription(result.proxy)),
    E('td', { class: 'td' }, new Date(result.checked_at).toLocaleString()),
  ]);
}

function render() {
  return E('div', { id: 'forkop-autodetect', class: 'fkp-autodetect' }, [
    E(
      'p',
      {},
      _('Compares HTTPS access directly and through the selected section.'),
    ),
    E(
      'p',
      { id: 'autodetect-status', role: 'status', 'aria-live': 'polite' },
      _('Loading…'),
    ),
    E('div', { class: 'fkp-autodetect__scroll' }, [
      E('table', { class: 'table' }, [
        E('thead', {}, [
          E(
            'tr',
            { class: 'tr table-titles' },
            [
              _('Domain'),
              _('Result'),
              _('Directly'),
              _('Through section'),
              _('Last check'),
            ].map((title) => E('th', { class: 'th', scope: 'col' }, title)),
          ),
        ]),
        E('tbody', { id: 'autodetect-results' }),
      ]),
    ]),
  ]);
}

let initialized = false;
async function initController() {
  if (initialized) return;
  initialized = true;
  const root = await onMount('forkop-autodetect');
  const status = root.querySelector<HTMLElement>('#autodetect-status')!;
  const body = root.querySelector<HTMLElement>('#autodetect-results')!;
  const polling = createPollChain(
    async () => {
      if (!root.isConnected || !isActiveLuciTab('autodetect')) return;
      const response = await getClashApiAutodetect();
      if (!response.success) {
        status.textContent =
          response.status === 404
            ? _('Autodetect is unavailable.')
            : response.error;
        return;
      }
      const snapshot = response.data;
      if (!snapshot || !Array.isArray(snapshot.results)) {
        status.textContent = _('Invalid Autodetect response');
        return;
      }
      status.textContent =
        snapshot.error ||
        (!snapshot.enabled
          ? _('Save and apply the settings to start Autodetect.')
          : snapshot.checking
            ? `${_('Checking')}: ${snapshot.checking} · ${_('Comparison section')}: ${snapshot.proxy}`
            : `${_('Comparison section')}: ${snapshot.proxy}`);
      body.replaceChildren(
        ...(snapshot.results.length
          ? snapshot.results.map(renderResult)
          : [
              E('tr', { class: 'tr' }, [
                E(
                  'td',
                  { class: 'td', colSpan: 5 },
                  _(
                    'No suspicious connections detected yet. Open a site that is not loading on a device routed through Forkop.',
                  ),
                ),
              ]),
            ]),
      );
    },
    () => 3000,
  );
  polling.start(0);
}

export const AutodetectTab = {
  render,
  initController,
  styles: `
    .fkp-autodetect { min-width: 0; }
    .fkp-autodetect > p { max-width: 80em; }
    .fkp-autodetect__scroll { overflow-x: auto; }
    .fkp-autodetect .td { overflow-wrap: anywhere; min-width: 9em; }
    .fkp-autodetect__source { font-size: 0.9em; opacity: 0.7; }
  `,
};
