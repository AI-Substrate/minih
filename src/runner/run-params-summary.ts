import type { RunParamsSummary } from './types.js';

export interface RunLabelValidationResult {
  ok: boolean;
  label?: string;
  error?: string;
}

const MAX_LABEL_CHARS = 120;
const MAX_KEYS = 20;
const MAX_KEY_CHARS = 64;
const MAX_VALUE_CHARS = 80;
const MAX_TOTAL_DISPLAY_CHARS = 2048;
const SECRET_KEY_PARTS = [
  'password',
  'passwd',
  'secret',
  'token',
  'api_key',
  'apikey',
  'credential',
  'auth',
];

export function validateRunLabel(
  input: string | undefined,
): RunLabelValidationResult {
  if (input === undefined) return { ok: true };
  const label = input.trim();
  if (label.length === 0) {
    return { ok: false, error: 'Run label must not be empty.' };
  }
  if ([...label].length > MAX_LABEL_CHARS) {
    return {
      ok: false,
      error: `Run label must be at most ${MAX_LABEL_CHARS} characters.`,
    };
  }
  if (
    label.includes('\n') ||
    label.includes('\r') ||
    label.includes(String.fromCharCode(0))
  ) {
    return {
      ok: false,
      error: 'Run label must not contain newline, carriage return, or NUL.',
    };
  }
  return { ok: true, label };
}

export function buildRunParamsSummary(
  params: Record<string, unknown> | undefined,
): RunParamsSummary | undefined {
  if (!params || Object.keys(params).length === 0) return undefined;

  const display: Record<string, string> = {};
  const redactedKeys: string[] = [];
  const omittedKeys: string[] = [];
  let truncated = false;
  let totalChars = 0;

  for (const [rawKey, value] of Object.entries(params)) {
    if (Object.keys(display).length >= MAX_KEYS) {
      omittedKeys.push(rawKey);
      truncated = true;
      continue;
    }

    let key = rawKey;
    if ([...key].length > MAX_KEY_CHARS) {
      key = truncateUnicode(key, MAX_KEY_CHARS);
      truncated = true;
    }

    let rendered: string;
    if (isSecretishKey(rawKey)) {
      rendered = '***redacted***';
      redactedKeys.push(rawKey);
    } else {
      const formatted = formatValue(value);
      rendered = formatted.value;
      if (formatted.truncated) truncated = true;
    }

    if (totalChars + key.length + rendered.length > MAX_TOTAL_DISPLAY_CHARS) {
      omittedKeys.push(rawKey);
      truncated = true;
      continue;
    }

    display[key] = rendered;
    totalChars += key.length + rendered.length;
  }

  return {
    schemaVersion: 1,
    display,
    truncated,
    redactedKeys,
    ...(omittedKeys.length > 0 && { omittedKeys }),
  };
}

function isSecretishKey(key: string): boolean {
  const lower = key.toLowerCase();
  const normalized = lower.replace(/[^a-z0-9]+/g, '_');
  return SECRET_KEY_PARTS.some(
    (part) => lower.includes(part) || normalized.includes(part),
  );
}

function formatValue(value: unknown): { value: string; truncated: boolean } {
  if (typeof value === 'string') {
    if ([...value].length <= MAX_VALUE_CHARS) {
      return { value, truncated: false };
    }
    return {
      value: `string(${[...value].length}): ${truncateUnicode(value, MAX_VALUE_CHARS - 14)}`,
      truncated: true,
    };
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return { value: String(value), truncated: false };
  }
  if (value === null) return { value: 'null', truncated: false };
  if (Array.isArray(value)) {
    return { value: `array(len=${value.length})`, truncated: false };
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>);
    const shown = keys.slice(0, 2);
    const suffix =
      keys.length > shown.length ? `,+${keys.length - shown.length}` : '';
    return {
      value: `object(keys=${shown.join(',')}${suffix})`,
      truncated: false,
    };
  }
  if (typeof value === 'undefined') {
    return { value: 'undefined', truncated: false };
  }
  return { value: String(value), truncated: false };
}

function truncateUnicode(value: string, maxChars: number): string {
  const chars = [...value];
  if (chars.length <= maxChars) return value;
  if (maxChars <= 1) return '…';
  return `${chars.slice(0, maxChars - 1).join('')}…`;
}
