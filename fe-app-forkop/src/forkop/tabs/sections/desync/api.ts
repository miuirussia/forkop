import type { DesyncDiagnostics } from './diagnostics';
import { callUbus } from '../../../../helpers/callUbus';
import type { DesyncCapabilities, DesyncOptions } from './model';

type Reply<T> = T & { success: boolean; message?: string };
type CapabilityMatrix = Record<
  string,
  { supported: boolean; requirements?: string }
>;
interface CoreDesyncCapabilities
  extends Omit<DesyncCapabilities, 'parameters'> {
  parameters?: string[] | CapabilityMatrix;
  mode_support?: CapabilityMatrix;
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
      modes?: string[];
      presets?: string[];
    }>('desync_capabilities');
    const core = reply.capabilities;
    const matrix =
      core?.parameters && !Array.isArray(core.parameters)
        ? core.parameters
        : undefined;
    const unsupported = Object.fromEntries(
      Object.entries(matrix || {})
        .filter(([, value]) => value.supported === false)
        .map(([key, value]) => [
          key,
          value.requirements || _('Unsupported by the installed core'),
        ]),
    );
    const requirements = Object.fromEntries(
      Object.entries(matrix || {})
        .filter(([, value]) => value.requirements)
        .map(([key, value]) => [key, value.requirements!]),
    );
    const unsupportedModes = Object.fromEntries(
      Object.entries(core?.mode_support || {})
        .filter(([, value]) => value.supported === false)
        .map(([key, value]) => [
          key,
          value.requirements || _('Unsupported by the installed core'),
        ]),
    );
    return {
      ...core,
      parameters: matrix
        ? Object.keys(matrix)
        : Array.isArray(core?.parameters)
          ? core.parameters
          : undefined,
      unsupported: { ...core?.unsupported, ...unsupported },
      requirements: { ...core?.requirements, ...requirements },
      unsupported_modes: { ...core?.unsupported_modes, ...unsupportedModes },
      supported: reply.available && core?.supported !== false,
      reason: reply.reason,
      modes: reply.capabilities?.modes || reply.modes,
      presets: reply.capabilities?.presets || reply.presets,
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
