import { message } from './messages';

// Number-and-unit pairs with a non-zero amount, as sing-box parses them: "0s" would mean no timeout.
export function isSingBoxDuration(value: string) {
  return /^(?=.*[1-9])([0-9]+(?:\.[0-9]+)?(?:ns|us|ms|s|m|h|d))+$/.test(value);
}

const UNIT_SECONDS: Record<string, number> = {
  ns: 1e-9,
  us: 1e-6,
  ms: 1e-3,
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
};

// The seconds a duration stands for, or null when it is none.
export function singBoxDurationSeconds(value: unknown) {
  return parseDuration(value, (amount, seconds) => Number(amount) * seconds);
}

export function singBoxDurationNanoseconds(value: unknown) {
  return parseDuration(value, (amount, seconds) => {
    const unit = Math.round(seconds * 1e9);
    const [whole, fraction = ''] = amount.split('.');
    let part = 0;
    // Discard sub-nanosecond parts within each duration component.
    for (let i = fraction.length - 1; i >= 0; i--) {
      part = Math.floor((part + Number(fraction[i]) * unit) / 10);
    }
    return Number(whole) * unit + part;
  });
}

function parseDuration(
  value: unknown,
  toUnits: (amount: string, unitSeconds: number) => number,
) {
  const text = `${value ?? ''}`.trim();
  if (!isSingBoxDuration(text)) {
    return null;
  }
  return [...text.matchAll(/([0-9]+(?:\.[0-9]+)?)(ns|us|ms|s|m|h|d)/g)].reduce(
    (total, [, amount, unit]) => total + toUnits(amount, UNIT_SECONDS[unit]),
    0,
  );
}

export function validateOptionalSingBoxDuration(value: unknown) {
  const normalized = value ? `${value}`.trim() : '';

  return !normalized || isSingBoxDuration(normalized)
    ? true
    : message.duration();
}

export function validateRequiredSingBoxDuration(value: unknown) {
  const normalized = value ? `${value}`.trim() : '';

  return normalized
    ? validateOptionalSingBoxDuration(normalized)
    : message.required();
}
