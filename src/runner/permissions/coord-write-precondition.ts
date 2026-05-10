/**
 * Coordination write precondition — Plan 018 / FX008.
 *
 * Refuses to start a `coordination: enabled` agent run when the resolved
 * permission policy denies `write`. Coordinated agents are contractually
 * required to write `output/report.json` on `control:stop` or idle-budget
 * exit (workshop 002 § Q1, docs/how/companion-mode.md). Without write
 * permission the run executes for up to `timeout` seconds and exits cleanly
 * without ever producing the canonical envelope — wasting budget and
 * leaving operators with no forensic trail.
 *
 * This precondition turns that 14-minute silent failure into a sub-second
 * actionable error: thrown synchronously with code `E205` and a message
 * that names the slug, the resolved preset, the resolution-chain layer
 * that supplied it, and three remediation paths.
 *
 * Reuses (does not extend) the existing 5-signal denial protocol from
 * `error-signal.ts` — runner.ts catches the throw, reads the carried
 * `PermissionDenialReason`, and routes through `fireTerminalDenial`.
 *
 * Domain: runner. Pure — no IO. Side-effect-free.
 */

import type { AgentDefinition } from '../types.js';
import type { PermissionDeniedKind } from './handler.js';
import type { ResolvedPolicy } from './policy.js';

/**
 * Error thrown when a coordinated agent's resolved policy denies write
 * and the operator hasn't set `--allow-coord-write-deny`. Caller
 * (runner.ts) catches this and drives the standard 5-signal denial.
 *
 * Carries enough structural info that the caller can build a full
 * `PermissionDenialReason` for `fireTerminalDenial` without re-deriving
 * provenance.
 */
export class CoordinationWriteDeniedError extends Error {
  /** Closed kind label for the denial reason — fed into `kind` on events.ts payloads. */
  readonly kind: Extract<PermissionDeniedKind, 'coord-write-deny'> =
    'coord-write-deny';
  readonly slug: string;
  readonly presetName: string;
  readonly presetSource: ResolvedPolicy['presetSource'];
  readonly errorCode: 'E205' = 'E205';

  constructor(args: {
    slug: string;
    presetName: string;
    presetSource: ResolvedPolicy['presetSource'];
    message: string;
  }) {
    super(args.message);
    this.name = 'CoordinationWriteDeniedError';
    this.slug = args.slug;
    this.presetName = args.presetName;
    this.presetSource = args.presetSource;
  }
}

/**
 * Optional config bag accepted by `assertCoordWriteAllowed`. Forward-compat
 * with FX010-4 — the helper signature commits to an options bag rather
 * than positional args so FX010 can swap the trigger condition (presence
 * of `$MINIH_OUTPUT_PATH` in `canonicalRoots`) without widening the call.
 */
export interface CoordWritePreconditionOptions {
  /**
   * Operator opt-out — set by `--allow-coord-write-deny` on `minih run`.
   * When `true`, the precondition does not fire even if the policy denies
   * write. Per-invocation only; intentionally has no env-var fallback so
   * it can never be silently inherited from a shell config.
   */
  allowCoordWriteDeny?: boolean;
  /**
   * Run directory. Reserved for FX010-4 — it will pass `runDir` so the
   * trigger condition can examine whether `canonicalRoots` covers
   * `${runDir}/output/`. R6/FX008 ignores it. Adding it now means FX010
   * doesn't widen the helper signature.
   */
  runDir?: string;
}

/**
 * Build the locked E205 message body. Pure — never reads from filesystem.
 *
 * The message is testable end-to-end (no env-dependent strings, no
 * timestamps) so unit tests can assert exact substrings.
 */
export function formatCoordWriteDeniedMessage(args: {
  slug: string;
  presetName: string;
  presetSource: ResolvedPolicy['presetSource'];
}): string {
  const { slug, presetName, presetSource } = args;
  const sourceHint =
    presetSource === 'sidecar'
      ? "\n\nIf the resolved source is 'sidecar' you may need:\n  minih agent permissions reset <slug>      # FX001 — clears the sticky lockedDefault"
      : '';
  return [
    `E205 COORDINATION_WRITE_DENIED — Coordinated agent '${slug}' resolved to preset`,
    `'${presetName}' which denies write. Coordinated agents MUST write`,
    'output/report.json on exit (workshop 002 § Q1, docs/how/companion-mode.md).',
    '',
    `Resolved from: ${presetSource}`,
    '',
    'Remediations (pick one):',
    "  1. Add `write: allow` to the agent's frontmatter `permissions.overrides`.",
    '     Edit:  <agentDir>/prompt.md',
    '  2. Pick a preset that allows write at the same source layer:',
    '     `trusted` (allows shell+write+url) or `yolo` (allows everything).',
    '  3. Pass --allow-coord-write-deny when running the agent (operator',
    '     acknowledges the run cannot persist its envelope; you must be sure).',
    sourceHint,
  ].join('\n');
}

/**
 * Inspect whether an environment-level rollback kill-switch is engaged.
 * The switch exists for ops emergencies only — it disables the
 * precondition entirely and re-enables the silent-failure surface this
 * fix was designed to eliminate.
 *
 * Returns `true` when `MINIH_DISABLE_COORD_WRITE_PRECONDITION` is set to
 * `1` or a case-insensitive `"true"`. Any other value (including absent)
 * returns `false`.
 *
 * Logs a stderr warning on every fire-bypass — operators who set this
 * see a banner anchored at line start, matching:
 *   `^\[minih\] Warning: MINIH_DISABLE_COORD_WRITE_PRECONDITION is set`
 *
 * Wired by FX008-8.
 */
export function isCoordWritePreconditionDisabled(): boolean {
  const v = process.env.MINIH_DISABLE_COORD_WRITE_PRECONDITION;
  if (v === undefined) return false;
  return v === '1' || v.toLowerCase() === 'true';
}

/**
 * Throws `CoordinationWriteDeniedError` (E205) when the resolved policy
 * is structurally incompatible with the coordinated-agent contract.
 *
 * Trigger condition (all four must be true):
 *   1. `definition.coordination?.enabled === true`
 *   2. `resolvedPolicy.decisions.write === 'deny'`
 *   3. operator did NOT pass `--allow-coord-write-deny`
 *   4. ops kill-switch `MINIH_DISABLE_COORD_WRITE_PRECONDITION` is NOT set
 *
 * Coord-disabled agents and write-allowed policies pass through silently.
 * The operator opt-out emits a stderr deprecation banner so abuse is
 * traceable without changing the inbox/state surface.
 *
 * Pure-ish: only side effect is the stderr banner on opt-out / bypass.
 * No filesystem, no MCP, no SDK calls.
 */
export function assertCoordWriteAllowed(
  definition: Pick<AgentDefinition, 'slug' | 'coordination'>,
  resolvedPolicy: Pick<
    ResolvedPolicy,
    'presetName' | 'presetSource' | 'decisions'
  >,
  options: CoordWritePreconditionOptions = {},
): void {
  const coordEnabled = definition.coordination?.enabled === true;
  const writeDenied = resolvedPolicy.decisions.write === 'deny';

  if (!coordEnabled || !writeDenied) {
    return;
  }

  if (isCoordWritePreconditionDisabled()) {
    process.stderr.write(
      '[minih] Warning: MINIH_DISABLE_COORD_WRITE_PRECONDITION is set; ' +
        `coord agent '${definition.slug}' booted with write-deny policy. ` +
        'Re-enables silent-failure mode FX008 was designed to eliminate.\n',
    );
    return;
  }

  if (options.allowCoordWriteDeny) {
    process.stderr.write(
      '[minih] Warning: --allow-coord-write-deny set; canonical session record will not be persisted ' +
        `(slug='${definition.slug}', preset='${resolvedPolicy.presetName}').\n`,
    );
    return;
  }

  throw new CoordinationWriteDeniedError({
    slug: definition.slug,
    presetName: resolvedPolicy.presetName,
    presetSource: resolvedPolicy.presetSource,
    message: formatCoordWriteDeniedMessage({
      slug: definition.slug,
      presetName: resolvedPolicy.presetName,
      presetSource: resolvedPolicy.presetSource,
    }),
  });
}
