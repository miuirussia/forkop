import { expect, it } from 'vitest';
import { probeDescription } from '..';

it('shows a stalled body as an error even after HTTP 200 was received', () => {
  expect(
    probeDescription({
      status: 200,
      stage: 'body',
      error: 'context deadline exceeded',
      duration_ms: 8000,
    }),
  ).toBe('HTTP 200 · Response transfer: context deadline exceeded');
});

it('distinguishes transport failures and complete HTTP replies', () => {
  expect(
    probeDescription({
      stage: 'tls',
      error: 'connection reset',
      duration_ms: 20,
    }),
  ).toBe('TLS: connection reset');
  expect(
    probeDescription({ stage: 'http', status: 403, duration_ms: 50 }),
  ).toBe('HTTP 403 · 50 ms');
});
