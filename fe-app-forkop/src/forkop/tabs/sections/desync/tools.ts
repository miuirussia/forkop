import { renderDesyncDiagnostics, type DesyncDiagnostics } from './diagnostics';
import { summarizeDesyncResults } from './results';
import { desyncActions, desyncField as field, desyncGroup } from './ui';
import { E } from '../../../../helpers/element';
import { desyncApi, type DesyncJob, type DesyncResult } from './api';
import {
  customDesync,
  importDesync,
  validateDesync,
  type DesyncOptions,
  type DesyncCapabilities,
} from './model';

export function renderDesyncTools(
  section: string,
  read: () => DesyncOptions,
  apply: (options: DesyncOptions) => void,
  capabilities: DesyncCapabilities,
) {
  const error = E('p', {
    role: 'alert',
    class: 'fkp-desync__error',
  });
  const diagnostics = E('pre', {
    style: 'white-space:pre-wrap;overflow-wrap:anywhere',
  });
  const learning = E('div');
  function showDiagnostics(snapshot: DesyncDiagnostics) {
    learning.replaceChildren(renderDesyncDiagnostics(snapshot));
    diagnostics.textContent = JSON.stringify(snapshot, null, 2);
    rawDiagnostics.hidden = false;
  }
  const diagnosticStatus = E('p', { 'aria-live': 'polite' });
  const diagnosticLabels = E(
    'p',
    {},
    _('Current strategy, switch reason and learning statistics'),
  );
  const refresh = button(_('Refresh diagnostics'), async () => {
    const snapshot = await desyncApi.diagnostics(section);
    showDiagnostics(snapshot);
  });
  const clear = button(_('Clear learning results'), async () => {
    await desyncApi.clear(section);
    diagnosticStatus.textContent = _('Learning results cleared');
    const snapshot = await desyncApi.diagnostics(section);
    showDiagnostics(snapshot);
  });
  const target = E('input', {
    type: 'text',
    placeholder: 'example.org:443',
    class: 'cbi-input-text',
  });
  const protocol = E(
    'select',
    {},
    ['tls', 'http', 'quic'].map((name) =>
      E(
        'option',
        {
          value: name,
          disabled:
            capabilities.protocols && !capabilities.protocols.includes(name),
        },
        name.toUpperCase(),
      ),
    ),
  );
  const candidates = E('textarea', {
    rows: 4,
    class: 'cbi-input-textarea',
    placeholder: '[{"preset":"split"},{"preset":"fake_split"}]',
  });
  const useCurrent = E(
    'button',
    {
      type: 'button',
      class: 'btn cbi-button',
      click: () => {
        try {
          candidates.value = JSON.stringify([customDesync(read())], null, 2);
        } catch (reason) {
          report(reason);
        }
      },
    },
    _('Test the current form strategy'),
  );
  const timeout = numeric('5', '1', '15');
  const repetitions = numeric('2', '1', '3');
  const budget = numeric('60', '1', '120');
  const bytes = numeric('65536', '1024', '1048576');
  const status = E('p', { role: 'status', 'aria-live': 'polite' });
  const results = E('div', { class: 'fkp-desync__table' });
  let job: DesyncJob | undefined;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const root = E('div', { class: 'fkp-desync__tools' });
  const poll = async () => {
    if (!job || job.state !== 'running') return;
    if (!root.isConnected) {
      // A dialog closed during a run releases its isolated probes as well.
      void desyncApi.cancel(job.id).catch(() => undefined);
      return;
    }
    try {
      update(await desyncApi.progress(job.id));
    } catch (reason) {
      report(reason);
    }
    if (job.state === 'running') timer = setTimeout(() => void poll(), 1500);
  };
  function update(value: DesyncJob) {
    job = value;
    const state =
      {
        running: _('Running'),
        completed: _('Completed'),
        cancelled: _('Cancelled'),
        failed: _('Failed'),
      }[job.state] || job.state;
    status.textContent = `${state}: ${job.completed ?? job.results?.length ?? 0}/${job.total ?? '?'}${job.error ? ` — ${job.error}` : ''}`;
    status.setAttribute(
      'class',
      job.state === 'failed' || job.error ? 'fkp-desync__failure' : '',
    );
    start.disabled = pending || job.state === 'running';
    cancel.disabled = pending || job.state !== 'running';
    results.replaceChildren(
      renderResults(summarizeDesyncResults(job.results || [])),
    );
  }
  function report(reason: unknown) {
    error.textContent =
      reason instanceof Error ? reason.message : String(reason);
  }
  function button(label: string, action: () => Promise<void>) {
    const node = E(
      'button',
      {
        type: 'button',
        class: 'btn cbi-button',
        click: () => {
          error.textContent = '';
          node.disabled = true;
          void action()
            .catch(report)
            .finally(() => {
              node.disabled = false;
            });
        },
      },
      label,
    );
    return node;
  }
  function renderResults(items: DesyncResult[]) {
    const metric = (value: unknown, suffix = '') =>
      typeof value === 'number' ? `${value}${suffix}` : '—';
    const check = (value: unknown) =>
      typeof value === 'boolean'
        ? value
          ? _('Success')
          : _('Failed')
        : _('Not tested');
    const headers = [
      _('Strategy'),
      _('Result'),
      'TLS',
      'HTTP',
      'QUIC',
      _('Latency'),
      _('Stability'),
      _('Speed'),
      _('Action'),
    ];
    return E('table', { class: 'table' }, [
      E(
        'thead',
        {},
        E(
          'tr',
          {},
          headers.map((text) => E('th', { scope: 'col' }, text)),
        ),
      ),
      E(
        'tbody',
        {},
        items.map((item) => {
          const choose = button(_('Apply as custom'), async () => {
            const options = customDesync(item.options);
            const valid = validateDesync(options, capabilities);
            if (valid !== true) throw new Error(valid);
            apply(options);
            status.setAttribute('class', '');
            status.textContent = _(
              'Custom strategy copied to this form. Save the section and apply configuration to activate it.',
            );
          });
          choose.disabled = !item.success;
          return E('tr', {}, [
            E(
              'td',
              { style: 'overflow-wrap:anywhere;max-width:22em' },
              JSON.stringify(item.options),
            ),
            E(
              'td',
              {
                class: item.error || !item.success ? 'fkp-desync__failure' : '',
              },
              item.error || check(item.success),
            ),
            ...[item.tls, item.http, item.quic].map((value) =>
              E(
                'td',
                { class: value === false ? 'fkp-desync__failure' : '' },
                check(value),
              ),
            ),
            E('td', {}, metric(item.latency_ms, ' ms')),
            E('td', {}, metric(item.stability, '%')),
            E('td', {}, metric(item.throughput_bps, ' B/s')),
            E('td', {}, choose),
          ]);
        }),
      ),
    ]);
  }
  const start = E(
    'button',
    {
      type: 'button',
      class: 'btn cbi-button cbi-button-positive',
      click: () => {
        if (pending || job?.state === 'running') return;
        error.textContent = '';
        void (async () => {
          const destination = target.value.trim();
          if (!validTarget(destination, protocol.value)) {
            target.focus();
            throw new Error(_('Enter a test target (host:port or URL)'));
          }
          let strategies: DesyncOptions[];
          if (candidates.value.trim()) {
            const value: unknown = JSON.parse(candidates.value);
            if (!Array.isArray(value) || !value.length || value.length > 8)
              throw new Error(_('Provide 1 to 8 candidate JSON objects'));
            strategies = value.map((value) =>
              importDesync(JSON.stringify(value)),
            );
          } else {
            const presets =
              protocol.value === 'quic'
                ? ['GT1', 'GT2', 'GT3', 'GT4']
                : protocol.value === 'http' && destination.startsWith('http:')
                  ? ['split', 'disorder', 'fake_split']
                  : ['split', 'tlsrec', 'fake_split'];
            strategies = presets.map((preset) => ({
              preset,
              auto_tune: false,
            }));
          }
          for (const options of strategies) {
            if (
              options.preset === 'auto' ||
              options.auto_tune === true ||
              options.adaptive !== undefined
            )
              throw new Error(
                _('Tuner candidates must be fixed manual strategies'),
              );
            options.auto_tune = false;
            const valid = validateDesync(options, capabilities);
            if (valid !== true) throw new Error(valid);
          }
          for (const input of [timeout, repetitions, budget, bytes]) {
            if (!input.checkValidity() || !input.value) {
              input.reportValidity();
              return;
            }
          }
          pending = true;
          start.disabled = true;
          status.setAttribute('class', '');
          status.textContent = _('Starting isolated strategy tests…');
          try {
            update(
              await desyncApi.start({
                section,
                target: destination,
                protocol: protocol.value,
                candidates: strategies,
                timeout: +timeout.value,
                repetitions: +repetitions.value,
                max_duration: +budget.value,
                max_bytes: +bytes.value,
              }),
            );
            timer = setTimeout(() => void poll(), 1000);
          } finally {
            pending = false;
            start.disabled = job?.state === 'running';
            cancel.disabled = job?.state !== 'running';
          }
        })().catch(report);
      },
    },
    _('Find a strategy'),
  );
  const cancel = E(
    'button',
    {
      type: 'button',
      class: 'btn cbi-button',
      disabled: true,
      click: () => {
        if (!job || pending) return;
        pending = true;
        cancel.disabled = true;
        if (timer) clearTimeout(timer);
        void desyncApi
          .cancel(job.id)
          .then(update)
          .catch((reason) => {
            report(reason);
            timer = setTimeout(() => void poll(), 1500);
          })
          .finally(() => {
            pending = false;
            start.disabled = job?.state === 'running';
            cancel.disabled = job?.state !== 'running';
            if (job?.state === 'running')
              timer = setTimeout(() => void poll(), 500);
          });
      },
    },
    _('Cancel tests'),
  );
  const rawDiagnostics = desyncGroup(_('Raw diagnostics JSON'), [diagnostics]);
  rawDiagnostics.hidden = true;
  const diagnosticView = E('div', {}, [
    diagnosticLabels,
    desyncActions([refresh, clear]),
    diagnosticStatus,
    learning,
    rawDiagnostics,
  ]);
  root.append(
    E(
      'p',
      {},
      _(
        'Tests use isolated connections. Active sections keep their configuration. Speed is measured only for suitable download targets; unavailable metrics are shown as not tested.',
      ),
    ),
    E('div', { class: 'fkp-desync__fields' }, [
      field(_('Test target'), target),
      field(_('Protocol'), protocol),
    ]),
    field(
      _('Candidates (JSON array; empty uses protocol defaults)'),
      candidates,
    ),
    desyncActions([useCurrent]),
    desyncGroup(_('Test limits'), [
      E('div', { class: 'fkp-desync__fields' }, [
        field(_('Timeout per probe (seconds)'), timeout),
        field(_('Repetitions'), repetitions),
        field(_('Total time limit (seconds)'), budget),
        field(_('Download limit (bytes)'), bytes),
      ]),
      E(
        'p',
        {},
        _('At most 8 candidates and 24 probes, one connection at a time.'),
      ),
    ]),
    desyncActions([start, cancel]),
    status,
    results,
  );
  return { error, diagnostics: diagnosticView, testing: root };
}

function numeric(value: string, min: string, max: string) {
  return E('input', {
    type: 'number',
    step: '1',
    value,
    min,
    max,
    required: true,
    class: 'cbi-input-text',
  });
}

function validTarget(value: string, protocol: string) {
  if (!value || /[\s\r\n]/.test(value)) return false;
  if (protocol === 'http') {
    try {
      const url = new URL(value);
      return (
        ['http:', 'https:'].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !!url.hostname
      );
    } catch {
      return false;
    }
  }
  const match = /^(?:[A-Za-z0-9._-]+|\[[A-Fa-f0-9:]+\]):([0-9]+)$/.exec(value);
  return !!match && +match[1] >= 1 && +match[1] <= 65535;
}
