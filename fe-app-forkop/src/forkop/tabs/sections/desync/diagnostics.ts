import { E } from '../../../../helpers/element';

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

export function renderDesyncDiagnostics(snapshot: DesyncDiagnostics) {
  const outbounds = Object.entries(snapshot.outbounds || {});
  if (!outbounds.length)
    return E(
      'p',
      {},
      _('No active Desync outbound. Save and apply the section first.'),
    );
  return E(
    'div',
    {},
    outbounds.map(([name, value]) =>
      E('div', {}, [
        E('strong', {}, name),
        E('dl', {}, [
          E('dt', {}, _('Current strategy')),
          E('dd', {}, value.current || _('No observations yet')),
          E('dt', {}, _('Switch reason')),
          E('dd', {}, value.reason || '—'),
          E('dt', {}, _('Active probes')),
          E('dd', {}, String(value.active ?? 0)),
          E('dt', {}, _('Learned destinations')),
          E(
            'dd',
            {},
            String(
              value.entry_count ?? Object.keys(value.entries || {}).length,
            ),
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
          'div',
          { style: 'overflow-x:auto' },
          E('table', { class: 'table' }, [
            E(
              'thead',
              {},
              E(
                'tr',
                {},
                [
                  _('Destination'),
                  _('Strategy'),
                  _('Success'),
                  _('Failed'),
                  _('Latency'),
                  _('Switch reason'),
                  _('Updated'),
                ].map((label) => E('th', { scope: 'col' }, label)),
              ),
            ),
            E(
              'tbody',
              {},
              Object.entries(value.entries || {}).flatMap(
                ([destination, entry]) =>
                  Object.entries(entry.strategies || {}).map(
                    ([strategy, score]) =>
                      E(
                        'tr',
                        {},
                        [
                          destination,
                          strategy,
                          String(score.success ?? 0),
                          String(score.failure ?? 0),
                          score.latency_ms === undefined
                            ? '—'
                            : `${Math.round(score.latency_ms * 100) / 100} ms`,
                          score.last_reason || '—',
                          entry.updated || '—',
                        ].map((text, index) =>
                          E(
                            'td',
                            {
                              style: 'overflow-wrap:anywhere',
                              class:
                                index === 3 && (score.failure ?? 0) > 0
                                  ? 'fkp-desync__failure'
                                  : '',
                            },
                            text,
                          ),
                        ),
                      ),
                  ),
              ),
            ),
          ]),
        ),
      ]),
    ),
  );
}
