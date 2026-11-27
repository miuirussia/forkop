import { E } from '../../../../helpers/element';
import { pageLanguage } from '../../../../helpers/relativeTime';

interface LearningScore {
  success?: number;
  failure?: number;
  latency_ms?: number;
  last_reason?: string;
}
interface LearningEntry {
  strategies?: Record<string, LearningScore>;
  updated?: string;
}
interface OutboundLearning {
  current?: string;
  reason?: string;
  active?: number;
  entries?: Record<string, LearningEntry>;
  entry_count?: number;
  entries_truncated?: boolean;
}
export interface DesyncDiagnostics {
  outbounds?: Record<string, OutboundLearning>;
}

function measurement(
  label: string,
  value: string | HTMLElement,
  className = '',
) {
  return E('div', {}, [
    E('dt', {}, label),
    E('dd', { class: className }, value),
  ]);
}

function updatedTime(value?: string) {
  if (!value) return E('span', {}, '—');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return E('span', {}, value);
  return E(
    'time',
    { dateTime: value, title: value },
    date.toLocaleString(pageLanguage(), {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
  );
}

export function renderDesyncDiagnostics(snapshot: DesyncDiagnostics) {
  const outbounds = Object.entries(snapshot.outbounds || {});
  if (!outbounds.length)
    return E(
      'p',
      { class: 'fkp-desync__diagnostic-empty' },
      _('No active Desync outbound. Save and apply the section first.'),
    );
  return E(
    'div',
    { class: 'fkp-desync__diagnostics' },
    outbounds.map(([name, value]) => {
      const entries = Object.entries(value.entries || {});
      return E('section', { class: 'fkp-desync__outbound' }, [
        E('h4', { class: 'fkp-desync__heading' }, name),
        E('dl', { class: 'fkp-desync__metrics fkp-desync__overview' }, [
          measurement(
            _('Current strategy'),
            value.current || _('No observations yet'),
          ),
          measurement(_('Switch reason'), value.reason || '—'),
          measurement(_('Active probes'), String(value.active ?? 0)),
          measurement(
            _('Learned destinations'),
            String(value.entry_count ?? entries.length),
          ),
        ]),
        ...(value.entries_truncated
          ? [
              E(
                'p',
                {},
                _(
                  'Only recent destinations are shown. The full history remains in the core cache.',
                ),
              ),
            ]
          : []),
        E(
          'ul',
          { class: 'fkp-desync__result-list' },
          entries.map(([destination, entry]) =>
            E('li', { class: 'fkp-desync__result fkp-desync__destination' }, [
              E(
                'dl',
                { class: 'fkp-desync__metrics fkp-desync__destination-header' },
                [
                  measurement(_('Destination'), destination),
                  measurement(_('Updated'), updatedTime(entry.updated)),
                ],
              ),
              E(
                'ul',
                { class: 'fkp-desync__strategies' },
                Object.entries(entry.strategies || {}).map(
                  ([strategy, score]) =>
                    E('li', { class: 'fkp-desync__strategy' }, [
                      E(
                        'dl',
                        {
                          class:
                            'fkp-desync__metrics fkp-desync__strategy-metrics',
                        },
                        [
                          measurement(_('Strategy'), strategy),
                          measurement(
                            _('Success'),
                            String(score.success ?? 0),
                            (score.success ?? 0) > 0
                              ? 'fkp-desync__success'
                              : '',
                          ),
                          measurement(
                            _('Failed'),
                            String(score.failure ?? 0),
                            (score.failure ?? 0) > 0
                              ? 'fkp-desync__failure'
                              : '',
                          ),
                          measurement(
                            _('Latency'),
                            score.latency_ms === undefined
                              ? '—'
                              : `${Math.round(score.latency_ms * 100) / 100} ms`,
                          ),
                        ],
                      ),
                      E(
                        'dl',
                        {
                          class:
                            'fkp-desync__metrics fkp-desync__strategy-reason',
                        },
                        [
                          measurement(
                            _('Switch reason'),
                            score.last_reason || '—',
                          ),
                        ],
                      ),
                    ]),
                ),
              ),
            ]),
          ),
        ),
        ...(!entries.length
          ? [
              E(
                'p',
                { class: 'fkp-desync__diagnostic-empty' },
                _('No observations yet'),
              ),
            ]
          : []),
      ]);
    }),
  );
}
