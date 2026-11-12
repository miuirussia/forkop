import { describe, expect, it } from 'vitest';

import { addGroupHealthCheckTailOptions } from '../healthCheck';

function healthCheck(intervalOption: string, idleDefault: string) {
  let interval = '1d';
  const fields: Record<string, CBIOption> = {};
  const map = {
    lookupOption: (name: string, itemId: string) =>
      name === intervalOption ? [{ formvalue: () => interval }, itemId] : null,
  };
  const section = {
    option: (_widget: unknown, name: string) => {
      const field = { option: name, map } as CBIOption;
      fields[name] = field;
      return field;
    },
  } as unknown as CBISection;
  addGroupHealthCheckTailOptions(section, idleDefault, intervalOption);
  return {
    validateIdle: (value: string) =>
      fields.idle_timeout.validate('settings', value),
    setInterval: (value: string) => {
      interval = value;
    },
  };
}

describe.each([
  ['URLTest', 'check_interval', '30m'],
  ['Fallback', 'health_check_interval', '5m'],
])('%s health checks', (_group, intervalOption, idleDefault) => {
  it('explains why a daily interval conflicts with the default idle timeout', () => {
    const check = healthCheck(intervalOption, idleDefault);

    expect(check.validateIdle(idleDefault)).toBe(
      'Idle timeout must be at least the check interval (1d)',
    );
    expect(check.validateIdle('1d')).toBe(true);
    expect(check.validateIdle('24h')).toBe(true);
    expect(check.validateIdle('2d')).toBe(true);
  });

  it('accepts the original timeout after the interval is shortened', () => {
    const check = healthCheck(intervalOption, idleDefault);

    expect(check.validateIdle(idleDefault)).not.toBe(true);
    check.setInterval('3m');
    expect(check.validateIdle(idleDefault)).toBe(true);
  });
});
