import { required } from '../../../cbi/required';
import { FORKOP_UCI_PACKAGE } from '../../../../constants';
import { desyncApi } from './api';
import { importDesync, loadDesync, validateDesync } from './model';
import type { DesyncCapabilities } from './model';
import { renderDesyncEditor, validateDesyncEditor } from './widget';

export function addDesyncOptions(section: CBISection) {
  let capabilities: Promise<DesyncCapabilities> | undefined;
  const support = new Map<string, DesyncCapabilities>();
  const option = section.taboption(
    'settings',
    form.TextValue,
    'desync_options',
    _('Desync'),
    _(
      'Presets provide defaults; explicit options override them. Custom disables Adaptive. Normal section conditions, DNS and global QUIC blocking still apply.',
    ),
  );
  option.modalonly = true;
  option.retain = true;
  option.rows = 8;
  option.depends('action', 'desync');
  option.load = async function (sectionId: string) {
    // Probe even if a section starts with another action: switching to Desync must be validated.
    try {
      capabilities ||= desyncApi.capabilities();
      support.set(sectionId, await capabilities);
    } catch (reason) {
      capabilities = undefined;
      support.set(sectionId, {
        supported: false,
        reason: _('Cannot verify Desync support: %s').format(
          reason instanceof Error ? reason.message : String(reason),
        ),
      });
    }
    const saved = String(
      uci.get(FORKOP_UCI_PACKAGE, sectionId, 'desync_options') || '{}',
    );
    try {
      const options = loadDesync(saved);
      return JSON.stringify(
        Object.keys(options).length ? options : { preset: 'auto' },
        null,
        2,
      );
    } catch {
      return saved;
    }
  };
  option.validate = required(function (sectionId: string, value: string) {
    try {
      const draft = validateDesyncEditor(this.getUIElement?.(sectionId)?.node);
      if (draft !== true) return draft;
      return validateDesync(
        importDesync(value),
        support.get(sectionId) || {
          supported: false,
          reason: _('Desync support has not been verified'),
        },
      );
    } catch (reason) {
      return reason instanceof Error ? reason.message : String(reason);
    }
  });
  option.write = function (sectionId: string, value: unknown) {
    const draft = validateDesyncEditor(this.getUIElement?.(sectionId)?.node);
    if (draft !== true) throw new Error(draft);
    const options = importDesync(String(value || '{}'));
    const valid = validateDesync(options, support.get(sectionId));
    if (valid !== true) throw new Error(valid);
    uci.set(
      FORKOP_UCI_PACKAGE,
      sectionId,
      'desync_options',
      JSON.stringify(options),
    );
  };
  // Hidden action changes must keep existing strategies.
  option.remove = function () {};
  const baseRender = option.renderWidget;
  option.renderWidget = async function (sectionId, index, value) {
    const sourceNode = await baseRender.call(this, sectionId, index, value);
    const source =
      (sourceNode as HTMLElement).tagName === 'TEXTAREA'
        ? (sourceNode as HTMLTextAreaElement)
        : (sourceNode as HTMLElement).querySelector('textarea');
    if (!source) return sourceNode;
    return renderDesyncEditor(
      sourceNode,
      source,
      sectionId,
      support.get(sectionId) || { supported: false },
    );
  };
}
