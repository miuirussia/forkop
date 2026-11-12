import { executeShellCommand } from '../../helpers/executeShellCommand';

export interface GeodataSourceState {
  id: string;
  kind: 'geosite' | 'geoip';
  label: string;
  ready: boolean;
  error: string;
  size: number;
  tag_count: number;
  updated_at: number;
  used_tags: string[];
}

export interface GeodataState {
  sources: GeodataSourceState[];
  job: { source: string; phase: string; error: string } | null;
}

export interface GeodataTag {
  name: string;
  count: number;
  reference: string;
}

async function call<T>(method: string, args: string[] = []): Promise<T> {
  const response = await executeShellCommand({
    command: '/usr/bin/forkop',
    args: [method, ...args],
    timeout: 15000,
  });
  const data = response.stdout ? JSON.parse(response.stdout) : null;
  if (response.code || data?.success === false) {
    throw new Error(
      data?.message || response.stderr || _('Geodata operation failed'),
    );
  }
  return data as T;
}

let stateRequest: Promise<GeodataState> | null = null;
export function getGeodataState() {
  stateRequest ??= call<GeodataState>('geodata_status').finally(() => {
    stateRequest = null;
  });
  return stateRequest;
}
export const updateGeodata = (id = '') => call('geodata_start', [id]);
export const getGeodataTags = (id: string, query = '', offset = 0) =>
  call<{ tags: GeodataTag[]; total: number; offset: number }>('geodata_tags', [
    id,
    query,
    String(offset),
  ]);

export function parseDatReference(value: string) {
  const match =
    /^dat:([A-Za-z0-9_]+):([a-z0-9_.!+-]+(?:@!?[a-z0-9_.+-]+)?)$/.exec(value);
  return match ? { source: match[1], tag: match[2] } : null;
}

export function validateGeodataInterval(value: string) {
  const match = /^([1-9][0-9]*)(m|h|d)$/.exec(value);
  const seconds = match
    ? Number(match[1]) * ({ m: 60, h: 3600, d: 86400 }[match[2]] ?? 0)
    : 0;
  return seconds >= 300 && seconds <= 31536000
    ? true
    : _('Use an interval from 5m to 365d, for example 12h or 1d');
}
