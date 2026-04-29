/**
 * T001 (Plan 011 HF-A) — formatMagicWandHint truncation rule.
 *
 * Workshop 002 / Plan 011: take first non-empty line, collapse whitespace,
 * truncate to 100 chars with `…` ellipsis.
 */

import { describe, expect, it } from 'vitest';
import { formatMagicWandHint } from '../../src/runner/display.js';

describe('formatMagicWandHint', () => {
  it('returns short single-line wand unchanged', () => {
    expect(formatMagicWandHint('do the thing')).toBe('do the thing');
  });

  it('takes first non-empty line of a multi-line wand', () => {
    expect(formatMagicWandHint('line one\nline two\nline three')).toBe(
      'line one',
    );
  });

  it('skips leading empty lines', () => {
    expect(formatMagicWandHint('\n\n  \nfirst real content\nmore')).toBe(
      'first real content',
    );
  });

  it('collapses internal whitespace to single spaces', () => {
    expect(formatMagicWandHint('lots   of    spaces\there')).toBe(
      'lots of spaces here',
    );
  });

  it('truncates to 100 chars with ellipsis when longer', () => {
    const long = 'a'.repeat(200);
    const result = formatMagicWandHint(long);
    expect(result).toHaveLength(101);
    expect(result.endsWith('…')).toBe(true);
    expect(result.slice(0, 100)).toBe('a'.repeat(100));
  });

  it('does not append ellipsis when exactly 100 chars after collapse', () => {
    const exactly100 = 'b'.repeat(100);
    expect(formatMagicWandHint(exactly100)).toBe(exactly100);
    expect(formatMagicWandHint(exactly100).endsWith('…')).toBe(false);
  });

  it('returns empty string for all-whitespace input', () => {
    expect(formatMagicWandHint('\n\n   \n  \n')).toBe('');
  });
});
