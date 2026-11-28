import { describe, expect, it } from 'vitest';
import {
  customDesync,
  exportDesync,
  importDesync,
  loadDesync,
  validateDesync,
} from '../model';

import { desyncContract as contract } from '../../../../../../tests/lib/desync.js';

describe('shared Desync extensions contract', () => {
  it.each(contract.accepted)('validates and round trips %j', (options) => {
    expect(validateDesync(options)).toBe(true);
    expect(importDesync(exportDesync(options))).toEqual(options);
    expect(loadDesync(JSON.stringify(options))).toEqual(options);
    const { adaptive: _adaptive, ...fixed } = options;
    expect(customDesync(options)).toMatchObject({
      ...fixed,
      preset: 'custom',
      auto_tune: false,
    });
  });
  it.each(contract.rejected)('rejects invalid combinations %j', (options) => {
    expect(validateDesync(options)).not.toBe(true);
  });
  it.each(contract.imports)(
    'validates effective imported overrides %j',
    (test) => {
      const options = loadDesync(JSON.stringify(test.input));
      expect(options).toEqual(test.options);
      expect(validateDesync(options)).toBe(true);
      expect(importDesync(exportDesync(options))).toEqual(options);
    },
  );
  it.each(contract.rejected_imports)(
    'rejects unsafe or invalid effective imports %j',
    (input) => {
      let valid = false;
      try {
        valid = validateDesync(loadDesync(JSON.stringify(input))) === true;
      } catch {
        // Syntactic/type failures must survive even an explicit override.
      }
      expect(valid).toBe(false);
    },
  );
  it('keeps explicit false, zero and empty strings ahead of imported settings', () => {
    expect(
      loadDesync(
        '{"strategy":"mode=fake_split fake_tls_random=true fake_tls_size=1200 fake_delay=100ms fake_tls_template=compact","fake_tls_random":false,"fake_tls_size":0,"fake_delay":"0s","fake_tls_template":""}',
      ),
    ).toEqual({
      mode: 'fake_split',
      fake_tls_random: false,
      fake_tls_size: 0,
      fake_delay: '0s',
      fake_tls_template: '',
    });
  });
  it('respects capability restrictions on extensions', () => {
    expect(
      validateDesync(
        { mode: 'split', segment_order: 'reverse' },
        {
          supported: true,
          parameters: ['mode'],
        },
      ),
    ).toContain('segment_order');
    expect(
      validateDesync(
        { mode: 'split', segment_order: 'reverse' },
        {
          supported: true,
          unsupported: { segment_order: 'Linux raw TCP required' },
        },
      ),
    ).toContain('Linux raw TCP required');
  });
});
