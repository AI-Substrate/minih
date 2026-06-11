import { describe, expect, it } from 'vitest';
import {
  buildRunParamsSummary,
  validateRunLabel,
} from '../../src/runner/run-params-summary.js';

describe('validateRunLabel', () => {
  it('trims and accepts a normal label', () => {
    expect(validateRunLabel(' id=1 ')).toEqual({ ok: true, label: 'id=1' });
  });

  it('rejects empty labels', () => {
    expect(validateRunLabel('   ').ok).toBe(false);
  });

  it('rejects labels with newlines or NUL', () => {
    expect(validateRunLabel('bad\nlabel').ok).toBe(false);
    expect(validateRunLabel(`bad${String.fromCharCode(0)}label`).ok).toBe(
      false,
    );
  });

  it('rejects labels over 120 characters', () => {
    expect(validateRunLabel('x'.repeat(121)).ok).toBe(false);
  });
});

describe('buildRunParamsSummary', () => {
  it('summarizes primitive params', () => {
    const summary = buildRunParamsSummary({
      id: 1,
      message: 'alpha',
      enabled: true,
      none: null,
    });
    expect(summary).toEqual({
      schemaVersion: 1,
      display: {
        id: '1',
        message: 'alpha',
        enabled: 'true',
        none: 'null',
      },
      truncated: false,
      redactedKeys: [],
    });
  });

  it('summarizes objects and arrays instead of dumping them', () => {
    const summary = buildRunParamsSummary({
      config: { mode: 'fast', retries: 2, extra: true },
      tags: ['a', 'b', 'c'],
    });
    expect(summary?.display.config).toBe('object(keys=mode,retries,+1)');
    expect(summary?.display.tags).toBe('array(len=3)');
  });

  it('redacts exact and compound secret-ish keys', () => {
    const summary = buildRunParamsSummary({
      token: 'abc',
      access_token: 'def',
      clientSecret: 'ghi',
      authHeader: 'jkl',
    });
    expect(summary?.display.token).toBe('***redacted***');
    expect(summary?.display.access_token).toBe('***redacted***');
    expect(summary?.display.clientSecret).toBe('***redacted***');
    expect(summary?.display.authHeader).toBe('***redacted***');
    expect(summary?.redactedKeys).toEqual([
      'token',
      'access_token',
      'clientSecret',
      'authHeader',
    ]);
  });

  it('bounds long string values', () => {
    const summary = buildRunParamsSummary({ value: 'a'.repeat(142) });
    expect(summary?.display.value).toMatch(/^string\(142\): /);
    expect(summary?.truncated).toBe(true);
  });

  it('omits keys beyond the max-key limit', () => {
    const params = Object.fromEntries(
      Array.from({ length: 22 }, (_, i) => [`k${i}`, i]),
    );
    const summary = buildRunParamsSummary(params);
    expect(Object.keys(summary?.display ?? {})).toHaveLength(20);
    expect(summary?.omittedKeys).toEqual(['k20', 'k21']);
    expect(summary?.truncated).toBe(true);
  });
});
