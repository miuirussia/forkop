import { describe, expect, it } from 'vitest';
import { validTarget } from '../tools';

describe('Desync probe targets', () => {
  it.each([
    'https://example.org/#fragment',
    'https://example.org/#',
    'http:example.org',
    'HTTP://example.org/',
    'https://user:password@example.org/',
    'https://example.org:99999/',
  ])('rejects HTTP input the backend cannot probe: %s', (target) => {
    expect(validTarget(target, 'http')).toBe(false);
  });

  it.each([
    'http://example.org',
    'https://example.org/path?test=1',
    'https://example.org/%23fragment',
    'http://[2001:db8::1]:8080/test',
  ])('accepts an explicit HTTP(S) URL: %s', (target) => {
    expect(validTarget(target, 'http')).toBe(true);
  });
});
