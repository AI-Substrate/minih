/**
 * Outside / inside context detection + the coordination env-var contract.
 *
 * `detectContext()` reads `process.env.MINIH` with **strict equality** to `'1'`.
 * Truthy-looking values (`'true'`, `'yes'`, `'TRUE'`, `'0'`, whitespace-padded
 * `' 1 '`, etc.) all return `'outside'`. The canonical writer is
 * `runner.ts:270` which sets `MINIH = '1'` exactly.
 *
 * `MINIH_ENV_KEYS_COORDINATION` is the new (P1 / Phase 007) contract for
 * coordination paths + context flag. Existing `MINIH_ENV_KEYS` from `runner.ts`
 * is intentionally NOT extended here; instead we expose `MINIH_ENV_KEYS_ALL`
 * as the composed view so P4 spawn config has a single point of contact.
 *
 * The runner sets `MINIH_CONTEXT=inside`, `MINIH_INBOX_DIR`, and
 * `MINIH_STATE_DIR` for coordinated runs, then clears them during run cleanup.
 */

import { MINIH_ENV_KEYS } from './runner.js';

/** New env-var keys introduced for the coordination capability. */
export const MINIH_ENV_KEYS_COORDINATION = [
  'MINIH_INBOX_DIR',
  'MINIH_STATE_DIR',
  'MINIH_CONTEXT',
] as const;

/**
 * Composed view: existing `MINIH_ENV_KEYS` (from runner.ts) PLUS the new
 * coordination keys. Use this when subprocesses need the
 * full set without consumers needing to merge two arrays at the call-site.
 */
export const MINIH_ENV_KEYS_ALL = [
  ...MINIH_ENV_KEYS,
  ...MINIH_ENV_KEYS_COORDINATION,
] as const;

/**
 * Return `'inside'` iff `process.env.MINIH === '1'` (strict equality).
 * Every other value (including empty string, `'0'`, `'true'`, whitespace) → `'outside'`.
 */
export function detectContext(): 'inside' | 'outside' {
  return process.env.MINIH === '1' ? 'inside' : 'outside';
}

/** Coordination env-var snapshot. `context` is always populated. */
export interface CoordinationEnv {
  inboxDir?: string;
  stateDir?: string;
  context: 'inside' | 'outside';
}

/** Read the three coordination env-vars; falls back to `detectContext()`. */
export function getCoordinationEnv(): CoordinationEnv {
  const env = process.env;
  return {
    inboxDir: env.MINIH_INBOX_DIR,
    stateDir: env.MINIH_STATE_DIR,
    context:
      env.MINIH_CONTEXT === 'inside' || env.MINIH_CONTEXT === 'outside'
        ? env.MINIH_CONTEXT
        : detectContext(),
  };
}
