/**
 * Permission policy types — the schema language for agent permissions.
 *
 * Plan 018 R1. Pinned to SDK 0.3.0 shape names per finding 01:
 *   - PermissionRequest.kind ∈ shell|write|mcp|read|url|custom-tool|memory|hook
 *   - PermissionDecision.kind ∈ approve-once|approve-for-session|approve-for-location|reject|user-not-available
 *
 * Domain: runner. Public via `src/runner/permissions/index.ts`.
 */

/**
 * The full set of permission kinds the SDK can request.
 *
 * Pinned to SDK 0.3.0 (`PermissionRequest.kind` union in
 * `node_modules/@github/copilot-sdk/dist/types.d.ts:580`). If the SDK
 * adds/removes/renames a kind, T-R1.14's shape regression test surfaces it
 * loudly so we can decide policy on the new kind explicitly rather than
 * silently approving it.
 */
export type PermissionKind =
  | 'shell'
  | 'write'
  | 'mcp'
  | 'read'
  | 'url'
  | 'custom-tool'
  | 'memory'
  | 'hook';

/** All known permission kinds, exported for iteration / preset derivation. */
export const ALL_PERMISSION_KINDS: readonly PermissionKind[] = [
  'shell',
  'write',
  'mcp',
  'read',
  'url',
  'custom-tool',
  'memory',
  'hook',
] as const;

/**
 * The decision shape minih emits per kind. Internally a string literal union
 * (`allow` | `deny` | `prompt-user`) — at handler-build time it is mapped to
 * the SDK's PermissionDecision union. We keep our own vocabulary for two
 * reasons:
 *   1. Insulate the policy layer from SDK shape drift (finding 01).
 *   2. Use a simpler 3-decision model — minih is not interactive yet, so the
 *      `prompt-user` decision is reserved for FX002 (`permissions check`).
 */
export type PermissionDecision = 'allow' | 'deny' | 'prompt-user';

/** Built-in preset names. The `getPreset()` registry is the source of truth. */
export type PermissionPresetName =
  | 'yolo'
  | 'trusted'
  | 'restricted'
  | 'read-only'
  | 'network'
  | 'build-only';

/**
 * Per-kind override map. Layered on top of a preset's baseline decisions.
 * `undefined` for a kind = "no override; preset's value wins".
 *
 * Per workshop 001 § Schema, `network` is a synthetic kind that maps to
 * `url` in the SDK — we accept either spelling in frontmatter for ergonomics.
 */
export type PermissionOverrides = Partial<Record<PermissionKind, PermissionDecision>>;

/**
 * Filesystem allow-list rule. The composition mode controls how multiple
 * sources (harness, frontmatter, env, CLI) merge per workshop 001 § Q5.
 *
 *   - `extend`: this layer's roots are added to the inherited list (default)
 *   - `replace`: this layer's roots wipe everything below
 */
export interface AllowedRootsRule {
  /** Composition mode for layer merging (default: 'extend'). */
  mode?: 'extend' | 'replace';
  /** Path strings — relative paths resolve against the agent's `cwd`. */
  roots: string[];
}

/**
 * The raw policy as expressed in frontmatter / sidecar / env / CLI.
 * Compiled by `compile()` into a `ResolvedPolicy`.
 */
export interface PermissionPolicy {
  /** One of the six preset names, OR `undefined` to mean "release default". */
  preset?: PermissionPresetName;
  /** Per-kind overrides applied on top of the preset. */
  overrides?: PermissionOverrides;
  /** Allowed roots; `undefined` ⇒ default to git root or cwd per workshop 001 § Q2. */
  allowedRoots?: AllowedRootsRule;
}

/**
 * Provenance entry for `ResolvedPolicy.rootsResolvedFrom` — explains why
 * each root is in the list (debuggability surface for `permissions list
 * --effective` and the `permission-error` envelope).
 */
export interface RootProvenance {
  root: string;
  source: 'harness' | 'frontmatter' | 'env' | 'cli' | 'git-root' | 'cwd-fallback';
  reason: string;
}

/**
 * The compiled policy that handlers actually consult. Built by `compile()`.
 *
 * Invariants:
 *   - `decisions` is total over `ALL_PERMISSION_KINDS` (every kind has a value).
 *   - `canonicalRoots` is non-empty (guaranteed by `resolveDefaultAllowedRoots`).
 *   - `rootsResolvedFrom.length === canonicalRoots.length` (parallel arrays
 *     keyed by index).
 */
export interface ResolvedPolicy {
  /** The preset that produced the baseline decisions. */
  presetName: PermissionPresetName;
  /** Total per-kind decision map after preset+overrides composition. */
  decisions: Record<PermissionKind, PermissionDecision>;
  /** Canonicalized, deduped, absolute roots. */
  canonicalRoots: string[];
  /** Provenance for each canonical root (parallel to `canonicalRoots`). */
  rootsResolvedFrom: RootProvenance[];
  /**
   * Strict-FS mode opt-in (Phase 6 stretch). When true, runner registers a
   * `createSessionFsHandler` that intercepts every SDK fs op. R1-R6 ignore
   * this field.
   */
  strictFs?: boolean;
}

/**
 * Build the per-kind decision matrix for a preset.
 *
 * Indirection over a bare `getPreset()` lookup so callers can compose
 * `applyPreset(name)` then `applyOverrides(map)` without re-walking the
 * preset registry. See `compile()` in this file.
 */
export function applyPreset(
  presetName: PermissionPresetName,
  presetDecisions: Record<PermissionKind, PermissionDecision>,
): Record<PermissionKind, PermissionDecision> {
  // Defensive copy — prevents callers from mutating the registry's source-of-truth tables.
  return { ...presetDecisions };
}

/**
 * Apply per-kind overrides on top of a baseline. Workshop 001 § Schema
 * defines `network` as an alias for `url`; we honour that here.
 */
export function applyOverrides(
  baseline: Record<PermissionKind, PermissionDecision>,
  overrides: PermissionOverrides | undefined,
): Record<PermissionKind, PermissionDecision> {
  if (!overrides) return baseline;
  const result = { ...baseline };
  for (const [kind, decision] of Object.entries(overrides) as [
    PermissionKind,
    PermissionDecision,
  ][]) {
    if (decision === undefined) continue;
    result[kind] = decision;
  }
  return result;
}

/**
 * Source labels for `compile()` provenance. Each source provides one
 * `PermissionPolicy` (or `undefined` if not present at that layer); the
 * resolution chain is documented in spec AC24:
 *
 *   frontmatter → sidecar `lockedDefault` → env `MINIH_PERMISSIONS_DEFAULT`
 *   → release default constant.
 */
export interface PolicySources {
  frontmatter?: PermissionPolicy;
  sidecar?: PermissionPolicy;
  env?: PermissionPolicy;
  releaseDefault: PermissionPolicy;
  /**
   * Harness-level allowedRoots (from the harness binary itself; rare).
   * Always replace-mode-eligible? No — workshop 001 § Q5 says harness
   * provides the floor and frontmatter/cli can `extend` only.
   */
  harness?: AllowedRootsRule;
  /** CLI flags `--allowed-roots` / `--allowed-roots-only`. */
  cli?: AllowedRootsRule;
  /** The agent's current working directory — needed for git-root walk. */
  cwd: string;
}
