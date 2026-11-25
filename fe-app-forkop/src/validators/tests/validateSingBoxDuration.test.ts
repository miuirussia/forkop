import { describe, expect, it } from 'vitest';

import {
  isSingBoxDuration,
  singBoxDurationNanoseconds,
  validateOptionalSingBoxDuration,
  validateRequiredSingBoxDuration,
} from '../validateSingBoxDuration';

describe('isSingBoxDuration', () => {
  it.each(['1s', '0.5s', '2m30s', '1d', '12h', '250ms', '100us', '10ns'])(
    'accepts %s',
    (value) => {
      expect(isSingBoxDuration(value)).toBe(true);
    },
  );

  it.each(['0s', '0h0m', '0.0s', '', '30', 'm', '1x', '1 s'])(
    'refuses %s',
    (value) => {
      expect(isSingBoxDuration(value)).toBe(false);
    },
  );
});

describe('singBoxDurationNanoseconds', () => {
  it.each([
    ['1m1ns', 60e9 + 1],
    ['0.54m27.6s0.9ns', 60e9],
    ['0.9ns0.9ns', 0],
  ])('converts %s to %i nanoseconds', (value, nanoseconds) => {
    expect(singBoxDurationNanoseconds(value)).toBe(nanoseconds);
  });
});

describe('validateOptionalSingBoxDuration', () => {
  it('accepts an empty field', () => {
    expect(validateOptionalSingBoxDuration('')).toBe(true);
    expect(validateOptionalSingBoxDuration(undefined)).toBe(true);
  });

  it('accepts a duration around whitespace', () => {
    expect(validateOptionalSingBoxDuration('  30m  ')).toBe(true);
  });

  it('answers with a reason rather than false', () => {
    expect(typeof validateOptionalSingBoxDuration('0s')).toBe('string');
  });
});

describe('validateRequiredSingBoxDuration', () => {
  it('refuses an empty field', () => {
    expect(typeof validateRequiredSingBoxDuration('')).toBe('string');
  });

  it('accepts a duration', () => {
    expect(validateRequiredSingBoxDuration('5m')).toBe(true);
  });
});
