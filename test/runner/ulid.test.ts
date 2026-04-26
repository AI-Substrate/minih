/**
 * ULID monotonicity contract tests.
 *
 * Per workshop 001 + dossier T002:
 * - Format ^[0-9A-HJKMNP-TV-Z]{26}$
 * - Sub-ms collision: 1000 calls in same ms remain lex-sortable
 * - Clock-rewind: explicit Date.now() rewind followed by 100 calls remain monotonic
 * - 10K-call burst: zero collisions, sorted-by-string == sorted-by-creation
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ulid } from '../../src/runner/ulid.js';

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

describe('ulid()', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits 26-char Crockford-base32 strings', () => {
    for (let i = 0; i < 100; i++) {
      const id = ulid();
      expect(id).toMatch(ULID_RE);
    }
  });

  it('produces unique IDs in a 10K-call burst', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i++) ids.add(ulid());
    expect(ids.size).toBe(10_000);
  });

  it('lex-sort matches creation order in a 10K-call burst', () => {
    const ids: string[] = [];
    for (let i = 0; i < 10_000; i++) ids.push(ulid());
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
  });

  it('preserves monotonicity for 1000 calls within a single ms (sub-ms collision)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-26T05:00:00.000Z'));

    const ids: string[] = [];
    for (let i = 0; i < 1000; i++) ids.push(ulid());

    expect(new Set(ids).size).toBe(1000);
    expect([...ids].sort()).toEqual(ids);
  });

  it('preserves monotonicity across an explicit clock rewind', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-26T05:00:00.100Z'));

    const before: string[] = [];
    for (let i = 0; i < 50; i++) before.push(ulid());

    // Rewind clock by 5ms (NTP step-backward simulation).
    vi.setSystemTime(new Date('2026-04-26T05:00:00.095Z'));

    const after: string[] = [];
    for (let i = 0; i < 100; i++) after.push(ulid());

    const all = [...before, ...after];
    expect(new Set(all).size).toBe(150);
    expect([...all].sort()).toEqual(all);
  });

  it('exports only `ulid` (narrow surface for future npm swap)', async () => {
    const mod = await import('../../src/runner/ulid.js');
    expect(Object.keys(mod).sort()).toEqual(['ulid']);
  });
});
