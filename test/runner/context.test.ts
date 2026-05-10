/**
 * Context detection + coordination env-var contract tests.
 *
 * Per dossier T005:
 * - detectContext() strict equality with '1' (no truthy coercion)
 * - Trap-value tests (MINIH=true, yes, TRUE, 0, '', ' 1 ', etc.)
 * - MINIH_ENV_KEYS_COORDINATION and MINIH_ENV_KEYS_ALL shape
 * - getCoordinationEnv() defaults
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  detectContext,
  getCoordinationEnv,
  MINIH_ENV_KEYS_ALL,
  MINIH_ENV_KEYS_COORDINATION,
} from '../../src/runner/context.js';
import { MINIH_ENV_KEYS } from '../../src/runner/runner.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('detectContext()', () => {
  it("returns 'inside' when MINIH === '1'", () => {
    vi.stubEnv('MINIH', '1');
    expect(detectContext()).toBe('inside');
  });

  it("returns 'outside' when MINIH is unset", () => {
    vi.stubEnv('MINIH', undefined as unknown as string);
    expect(detectContext()).toBe('outside');
  });

  // Strict-equality trap values — every one MUST resolve to 'outside'.
  it.each([
    ['', 'empty string'],
    ['0', "'0'"],
    ['true', "'true'"],
    ['TRUE', "'TRUE' (uppercase)"],
    ['yes', "'yes'"],
    [' 1 ', "' 1 ' (whitespace-padded)"],
    ['1\n', "'1\\n' (trailing newline)"],
    ['true,', "'true,' (trailing comma)"],
    ['inside', "'inside' (literal — would be tempting)"],
  ])('returns outside for MINIH=%j (%s)', (val) => {
    vi.stubEnv('MINIH', val);
    expect(detectContext()).toBe('outside');
  });
});

describe('MINIH_ENV_KEYS_COORDINATION', () => {
  it('contains exactly the three new coordination keys', () => {
    expect([...MINIH_ENV_KEYS_COORDINATION].sort()).toEqual([
      'MINIH_CONTEXT',
      'MINIH_INBOX_DIR',
      'MINIH_STATE_DIR',
    ]);
  });
});

describe('MINIH_ENV_KEYS_ALL', () => {
  it('is the composed union of existing + new keys', () => {
    expect(MINIH_ENV_KEYS_ALL.length).toBe(
      MINIH_ENV_KEYS.length + MINIH_ENV_KEYS_COORDINATION.length,
    );
  });

  it('includes the existing MINIH_ENV_KEYS unchanged (no renames)', () => {
    for (const key of MINIH_ENV_KEYS) {
      expect(MINIH_ENV_KEYS_ALL).toContain(key);
    }
  });

  it('includes all three new coordination keys', () => {
    for (const key of MINIH_ENV_KEYS_COORDINATION) {
      expect(MINIH_ENV_KEYS_ALL).toContain(key);
    }
  });
});

describe('getCoordinationEnv()', () => {
  it("returns context='outside' with no inboxDir/stateDir when nothing is set", () => {
    vi.stubEnv('MINIH', undefined as unknown as string);
    vi.stubEnv('MINIH_INBOX_DIR', undefined as unknown as string);
    vi.stubEnv('MINIH_STATE_DIR', undefined as unknown as string);
    vi.stubEnv('MINIH_CONTEXT', undefined as unknown as string);
    const env = getCoordinationEnv();
    expect(env).toEqual({
      inboxDir: undefined,
      stateDir: undefined,
      context: 'outside',
    });
  });

  it('reads MINIH_INBOX_DIR / MINIH_STATE_DIR when set', () => {
    vi.stubEnv('MINIH_INBOX_DIR', '/tmp/inbox');
    vi.stubEnv('MINIH_STATE_DIR', '/tmp/state');
    const env = getCoordinationEnv();
    expect(env.inboxDir).toBe('/tmp/inbox');
    expect(env.stateDir).toBe('/tmp/state');
  });

  it('prefers MINIH_CONTEXT over MINIH for context resolution when valid', () => {
    vi.stubEnv('MINIH', undefined as unknown as string);
    vi.stubEnv('MINIH_CONTEXT', 'inside');
    expect(getCoordinationEnv().context).toBe('inside');
  });

  it('ignores invalid MINIH_CONTEXT and falls back to detectContext()', () => {
    vi.stubEnv('MINIH', '1');
    vi.stubEnv('MINIH_CONTEXT', 'martian');
    expect(getCoordinationEnv().context).toBe('inside');
  });
});
