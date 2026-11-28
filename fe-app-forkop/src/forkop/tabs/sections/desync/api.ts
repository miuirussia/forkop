import type { DesyncDiagnostics } from './diagnostics';
import { callUbus } from '../../../../helpers/callUbus';
import type { DesyncCapabilities, DesyncOptions } from './model';
import { DESYNC_KEYS, DESYNC_MODES, DESYNC_PRESETS } from './model';

type Reply<T> = T & { success: boolean; message?: string };
type CapabilityMatrix = Record<
  string,
  { supported: boolean; requirements: string }
>;
interface CoreDesyncCapabilities {
  capability: string;
  version: number;
  supported: boolean;
  platform: string;
  active_api: string;
  limits: { attempts: number; max_bytes: number; timeout: string };
  modes: string[];
  presets: string[];
  protocols: string[];
  parameters: CapabilityMatrix;
  mode_support: CapabilityMatrix;
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function names(value: unknown, expected: string[]) {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    expected.every((name) => value.includes(name))
  );
}
function matrix(value: unknown, expected: string[]) {
  return (
    object(value) &&
    names(Object.keys(value), expected) &&
    Object.values(value).every(
      (entry) =>
        object(entry) &&
        typeof entry.supported === 'boolean' &&
        typeof entry.requirements === 'string',
    )
  );
}
function currentCapabilities(core?: CoreDesyncCapabilities) {
  return (
    object(core) &&
    core.capability === 'forkop-desync-v1' &&
    core.version === 1 &&
    core.supported === true &&
    typeof core.platform === 'string' &&
    /^[a-z0-9]+$/.test(core.platform) &&
    core.active_api === '/desync' &&
    object(core.limits) &&
    core.limits.attempts === 1 &&
    core.limits.max_bytes === 1048576 &&
    core.limits.timeout === '1s..15s' &&
    matrix(core.parameters, DESYNC_KEYS) &&
    matrix(core.mode_support, DESYNC_MODES) &&
    names(core.modes, DESYNC_MODES) &&
    names(core.presets, DESYNC_PRESETS) &&
    (names(core.protocols, ['tls', 'http']) ||
      names(core.protocols, ['tls', 'http', 'quic']))
  );
}
export interface DesyncResult {
  options: DesyncOptions;
  success: boolean;
  protocol?: string;
  candidate?: number;
  tls_version?: number;
  latency_ms?: number;
  stability?: number;
  throughput_bps?: number;
  tls?: boolean;
  http?: boolean;
  quic?: boolean;
  error?: string;
}
export interface DesyncJob {
  id: string;
  state: 'running' | 'completed' | 'cancelled' | 'failed';
  results: DesyncResult[];
  completed?: number;
  total?: number;
  error?: string;
}
export interface TuneRequest {
  section: string;
  target: string;
  protocol: string;
  candidates: DesyncOptions[];
  timeout: number;
  repetitions: number;
  max_duration: number;
  max_bytes: number;
}
// Mutations are never retried: a lost answer may already have started or cancelled a job.
export async function desyncRequest<T>(
  method: string,
  payload: object = {},
): Promise<T> {
  const response = await callUbus<Reply<T>>({
    object: 'forkop',
    method,
    params: { payload: JSON.stringify(payload) },
    timeoutMs: 15000,
    retryUnavailable: false,
  });
  if (!response.success) throw new Error(response.message);
  if (!response.data.success)
    throw new Error(response.data.message || _('Desync request failed'));
  return response.data;
}
export const desyncApi = {
  capabilities: async (): Promise<DesyncCapabilities> => {
    const reply = await desyncRequest<{
      available: boolean;
      reason?: string;
      capabilities?: CoreDesyncCapabilities;
    }>('desync_capabilities');
    const core = reply.capabilities;
    if (!reply.available || !core || !currentCapabilities(core))
      return {
        supported: false,
        reason: reply.reason || _('The installed core does not support Desync'),
      };
    const matrix = core.parameters;
    const unsupported = Object.fromEntries(
      Object.entries(matrix)
        .filter(([, value]) => value.supported === false)
        .map(([key, value]) => [
          key,
          value.requirements || _('Unsupported by the installed core'),
        ]),
    );
    const requirements = Object.fromEntries(
      Object.entries(matrix)
        .filter(([, value]) => value.requirements)
        .map(([key, value]) => [key, value.requirements!]),
    );
    const unsupportedModes = Object.fromEntries(
      Object.entries(core.mode_support)
        .filter(([, value]) => value.supported === false)
        .map(([key, value]) => [
          key,
          value.requirements || _('Unsupported by the installed core'),
        ]),
    );
    return {
      ...core,
      parameters: Object.keys(matrix),
      unsupported,
      requirements,
      unsupported_modes: unsupportedModes,
      supported: true,
    };
  },
  diagnostics: async (section: string) => {
    const response = await desyncRequest<{ diagnostics: DesyncDiagnostics }>(
      'desync_diagnostics',
      { section },
    );
    return response.diagnostics;
  },
  clear: (section: string) => desyncRequest('desync_clear_cache', { section }),
  start: (request: TuneRequest) =>
    desyncRequest<DesyncJob>('desync_tune_start', request),
  progress: (id: string) =>
    desyncRequest<DesyncJob>('desync_tune_progress', { id }),
  cancel: (id: string) =>
    desyncRequest<DesyncJob>('desync_tune_cancel', { id }),
};
