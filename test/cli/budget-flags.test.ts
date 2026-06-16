/**
 * Plan 026 review FT-004 — unit proof of the budget resolution `run` and
 * `resume` share: explicit flag → agent frontmatter (`timeout` wall-clock +
 * `stallTimeout`, plan 028) → shared runner defaults. The E108 invalid-input
 * paths are covered by the
 * built-CLI subprocess tests in run-budget-flags.test.ts.
 */

import { describe, expect, it } from 'vitest';
import { resolveEffectiveBudgets } from '../../src/cli/budget-flags.js';
import {
  DEFAULT_STALL_TIMEOUT_SEC,
  DEFAULT_TIMEOUT_SEC,
} from '../../src/runner/index.js';

describe('resolveEffectiveBudgets (plan 026 FT-004)', () => {
  it('explicit resume flags win over frontmatter and defaults', () => {
    expect(
      resolveEffectiveBudgets(
        'resume',
        { timeout: '120', stallTimeout: '45', maxTurns: '9' },
        600,
      ),
    ).toEqual({ timeout: 120, stallTimeout: 45, maxTurns: 9 });
  });

  it('falls back to agent frontmatter for the wall-clock timeout', () => {
    expect(resolveEffectiveBudgets('resume', {}, 600)).toEqual({
      timeout: 600,
      stallTimeout: DEFAULT_STALL_TIMEOUT_SEC,
      maxTurns: 0,
    });
  });

  it('falls back to the shared runner defaults with no flags or frontmatter', () => {
    expect(resolveEffectiveBudgets('resume', {}, undefined)).toEqual({
      timeout: DEFAULT_TIMEOUT_SEC,
      stallTimeout: DEFAULT_STALL_TIMEOUT_SEC,
      maxTurns: 0,
    });
  });

  it('stall-timeout 0 disables the watchdog rather than re-defaulting', () => {
    expect(
      resolveEffectiveBudgets('resume', { stallTimeout: '0' }, undefined)
        .stallTimeout,
    ).toBe(0);
  });
});
