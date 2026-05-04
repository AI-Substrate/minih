/**
 * Policy compiler — Plan 018 R1.
 *
 * Composes raw policies from four sources (frontmatter → sidecar → env →
 * release-default per AC24) into a `ResolvedPolicy` with full provenance.
 *
 * Workshop 003 § Q3 (lockedDefault sidecar) + workshop 001 § Q5 (allowedRoots
 * composition) define the precise resolution chain.
 *
 * Domain: runner. Pure — no IO. Caller passes already-loaded sources.
 */

import { canonicalizeRoots, resolveDefaultAllowedRoots } from './fs-guard.js';
import type { PermissionPresetName } from './policy.js';
import {
  applyOverrides,
  applyPreset,
  type PermissionPolicy,
  type PolicySources,
  type ResolvedPolicy,
} from './policy.js';
import { getPreset, isPresetName, minihReleaseDefault } from './presets.js';

/**
 * Resolve which preset wins after walking the resolution chain.
 *
 * Per AC24:
 *   frontmatter.preset → sidecar.preset → env.preset → minihReleaseDefault
 *
 * Whichever layer first specifies a preset wins. Absent layers are skipped.
 */
function resolvePreset(sources: PolicySources): {
  presetName: PermissionPresetName;
  source: 'frontmatter' | 'sidecar' | 'env' | 'release-default';
} {
  if (sources.frontmatter?.preset) {
    return { presetName: sources.frontmatter.preset, source: 'frontmatter' };
  }
  if (sources.sidecar?.preset) {
    return { presetName: sources.sidecar.preset, source: 'sidecar' };
  }
  if (sources.env?.preset) {
    return { presetName: sources.env.preset, source: 'env' };
  }
  if (sources.releaseDefault.preset) {
    return {
      presetName: sources.releaseDefault.preset,
      source: 'release-default',
    };
  }
  return { presetName: minihReleaseDefault, source: 'release-default' };
}

/**
 * Build the `ResolvedPolicy`. Throws on invalid inputs (unknown preset,
 * empty/forbidden roots — see fs-guard.ts errors).
 */
export function compile(sources: PolicySources): ResolvedPolicy {
  const { presetName } = resolvePreset(sources);
  if (!isPresetName(presetName)) {
    // Belt-and-braces — `resolvePreset` constrains the type, but a
    // sidecar/env value could carry a stale preset name from a prior
    // release.
    throw new Error(
      `unknown preset name in resolution chain: ${String(presetName)}`,
    );
  }
  const baseline = applyPreset(presetName, getPreset(presetName));

  // Frontmatter overrides win over sidecar/env overrides — preset is
  // unitary but overrides can stack (frontmatter applied last).
  let decisions = baseline;
  if (sources.env?.overrides) {
    decisions = applyOverrides(decisions, sources.env.overrides);
  }
  if (sources.sidecar?.overrides) {
    decisions = applyOverrides(decisions, sources.sidecar.overrides);
  }
  if (sources.frontmatter?.overrides) {
    decisions = applyOverrides(decisions, sources.frontmatter.overrides);
  }

  // allowedRoots: 4-source merge per workshop 001 § Q5.
  const defaults = resolveDefaultAllowedRoots(sources.cwd);
  const layers: Array<{
    source: 'harness' | 'frontmatter' | 'env' | 'cli';
    rule: PermissionPolicy['allowedRoots'] | undefined;
  }> = [
    { source: 'harness', rule: sources.harness },
    { source: 'frontmatter', rule: sources.frontmatter?.allowedRoots },
    { source: 'env', rule: sources.env?.allowedRoots },
    { source: 'cli', rule: sources.cli },
  ];

  const { canonicalRoots, rootsResolvedFrom } = canonicalizeRoots(
    layers,
    defaults,
  );

  return {
    presetName,
    decisions,
    canonicalRoots,
    rootsResolvedFrom,
    strictFs: false,
  };
}
