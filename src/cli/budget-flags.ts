/**
 * Plan 026 — shared budget-flag parsing for `run` and `resume`.
 *
 * The legacy `Number.parseInt` parsing silently accepted NaN/negative
 * values (finding 04); every budget flag now validates loudly (E108)
 * before any run state is touched.
 */

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
