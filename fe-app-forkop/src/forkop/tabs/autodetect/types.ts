export interface AutodetectProbe {
  status?: number;
  stage: string;
  error?: string;
  duration_ms: number;
}

export interface AutodetectResult {
  domain: string;
  target: string;
  source: string;
  verdict: 'accessible' | 'blocked' | 'restricted' | 'inconclusive';
  signal: 'no_reply' | 'early_close' | 'stalled';
  checked_at: string;
  direct: AutodetectProbe;
  proxy: AutodetectProbe;
}

export interface AutodetectSnapshot {
  enabled: boolean;
  proxy?: string;
  checking?: string;
  error?: string;
  results: AutodetectResult[];
}
