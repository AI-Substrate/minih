/**
 * Plan 026 — shared budget-flag parsing for `run` and `resume`.
 *
 * The legacy `Number.parseInt` parsing silently accepted NaN/negative
 * values (finding 04); every budget flag now validates loudly (E108)
 * before any run state is touched.
 */

import {
  DEFAULT_STALL_TIMEOUT_SEC,
  DEFAULT_TIMEOUT_SEC,
} from '../runner/index.js';
import { ErrorCodes, exitWithEnvelope, formatError } from './output.js';

export type BudgetFlagKind =
  /** Wall-clock timeout — must be a positive integer (0 is not "disable"). */
  | 'positive-seconds'
  /** Stall budget — non-negative integer; 0 disables the watchdog. */
  | 'non-negative-seconds'
  /** Turn budget — non-negative integer; 0 means unlimited. */
  | 'non-negative-count';

/**
 * Parse one budget flag. Returns `undefined` when the flag was not given
 * (caller applies its default); exits with E108 on invalid input.
 */
export function parseBudgetFlag(
  commandName: string,
  flagName: string,
  raw: string | undefined,
  kind: BudgetFlagKind,
): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  const valid =
    Number.isInteger(value) &&
    (kind === 'positive-seconds' ? value > 0 : value >= 0);
  if (!valid) {
    const expected =
      kind === 'positive-seconds'
        ? 'a positive integer number of seconds'
        : kind === 'non-negative-seconds'
          ? 'a non-negative integer number of seconds (0 disables)'
          : 'a non-negative integer count (0 = unlimited)';
    exitWithEnvelope(
      formatError(
        commandName,
        ErrorCodes.INVALID_ARGS,
        `Invalid ${flagName} value "${raw}". Expected ${expected}.`,
        { flag: flagName, value: raw },
      ),
    );
  }
  return value;
}

export interface EffectiveBudgets {
  timeout: number;
  stallTimeout: number;
  maxTurns: number;
}

/**
 * Resolve the effective run budgets from raw flag strings, agent
 * frontmatter, and the shared runner defaults — the single resolution path
 * `run` and `resume` share (plan 026 review FT-004 pins resume's positive
 * path through this helper).
 *
 * Precedence: explicit flag → frontmatter `timeout` (wall-clock only) →
 * `DEFAULT_TIMEOUT_SEC` / `DEFAULT_STALL_TIMEOUT_SEC` / 0 (unlimited turns).
 */
export function resolveEffectiveBudgets(
  commandName: string,
  flags: { timeout?: string; stallTimeout?: string; maxTurns?: string },
  definitionTimeout?: number,
): EffectiveBudgets {
  return {
    timeout:
      parseBudgetFlag(
        commandName,
        '--timeout',
        flags.timeout,
        'positive-seconds',
      ) ??
      definitionTimeout ??
      DEFAULT_TIMEOUT_SEC,
    stallTimeout:
      parseBudgetFlag(
        commandName,
        '--stall-timeout',
        flags.stallTimeout,
        'non-negative-seconds',
      ) ?? DEFAULT_STALL_TIMEOUT_SEC,
    maxTurns:
      parseBudgetFlag(
        commandName,
        '--max-turns',
        flags.maxTurns,
        'non-negative-count',
      ) ?? 0,
  };
}
