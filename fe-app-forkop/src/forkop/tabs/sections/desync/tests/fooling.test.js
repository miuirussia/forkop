import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { exportDesync, importDesync, validateDesync } from '../model';

const contract = JSON.parse(
  readFileSync(
    new URL(
      '../../../../../../../tests/fixtures/desync_fooling.json',
      import.meta.url,
    ),
    'utf8',
  ),
);

describe('shared fooling interchange contract', () => {
  it.each(contract.exports)(
    'imports the actual core export $strategy',
    ({ options, strategy }) => {
      expect(importDesync(strategy)).toEqual(options);
      expect(validateDesync(importDesync(strategy))).toBe(true);
      expect(() => importDesync(`${strategy} fooling=badseq`)).toThrow();
      expect(() => importDesync('mode=fake_split fooling=')).toThrow();
    },
  );
  it.each(contract.accepted)(
    'validates and round trips fooling=%s',
    (fooling) => {
      const options = {
        mode: 'fake_split',
        fooling,
        auto_tune: false,
        seqovl: 0,
      };
      expect(
        validateDesync(options, { supported: true, platform: 'linux' }),
      ).toBe(true);
      expect(importDesync(exportDesync(options))).toEqual(options);
      expect(importDesync(JSON.stringify(options))).toEqual(options);
    },
  );
  it.each(contract.rejected)('rejects unsupported fooling=%s', (fooling) => {
    expect(validateDesync({ mode: 'fake_split', fooling })).not.toBe(true);
  });
});
