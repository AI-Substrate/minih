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
 * Per-kind override value. Most overrides are scalar decisions
 * (allow/deny/prompt-user). For `mcp` and `custom-tool`, AC2 also accepts
 * an object form with allowlists:
 *
 *   `mcp: { allowedServers: ['minih-coordination'] }`
 *   `custom-tool: { allowedNames: ['my-tool'] }`
 *
 * The decision for these kinds becomes `allow` when allowlist is non-empty;
 * the runtime gate then narrows to the listed servers/tools.
 */
export type PermissionOverrideValue =
  | PermissionDecision
  | { allowedServers: string[] }
  | { allowedNames: string[] };

/**
 * Per-kind override map. Layered on top of a preset's baseline decisions.
 * `undefined` for a kind = "no override; preset's value wins".
 *
 * Per workshop 001 § Schema, `network` is a synthetic kind that maps to
 * `url` in the SDK — we accept either spelling in frontmatter for ergonomics.
 */
export type PermissionOverrides = Partial<
  Record<PermissionKind, PermissionOverrideValue>
>;

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
  source:
    | 'harness'
    | 'frontmatter'
    | 'env'
    | 'cli'
    | 'git-root'
    | 'cwd-fallback';
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
  /**
   * AC2/AC33 — per-server MCP allowlist when `mcp` decision is `allow` AND
   * the override carries `allowedServers`. `undefined` = `mcp` allow is
   * unrestricted. Empty array = `mcp` is denied (effective deny).
   */
  mcpAllowedServers?: string[];
  /**
   * AC2/AC33 — per-name `custom-tool` allowlist. Same semantics as
   * `mcpAllowedServers`.
   */
  customToolAllowedNames?: string[];
}

/**
 * Build the per-kind decision matrix for a preset.
 *
 * Indirection over a bare `getPreset()` lookup so callers can compose
 * `applyPreset(name)` then `applyOverrides(map)` without re-walking the
 * preset registry. See `compile()` in this file.
 */
export function applyPreset(
  _presetName: PermissionPresetName,
  presetDecisions: Record<PermissionKind, PermissionDecision>,
): Record<PermissionKind, PermissionDecision> {
  // Defensive copy — prevents callers from mutating the registry's source-of-truth tables.
  return { ...presetDecisions };
}

/**
 * Apply per-kind overrides on top of a baseline. Workshop 001 § Schema
 * defines `network` as an alias for `url`; we honour that here.
 *
 * AC2 — object-form overrides with allowlists are extracted into the
 * separate `allowlists` output; the kind decision becomes `allow` when
 * the allowlist is non-empty (acts as a narrow allow rather than blanket).
 */
export function applyOverrides(
  baseline: Record<PermissionKind, PermissionDecision>,
  overrides: PermissionOverrides | undefined,
): {
  decisions: Record<PermissionKind, PermissionDecision>;
  mcpAllowedServers?: string[];
  customToolAllowedNames?: string[];
} {
  if (!overrides) return { decisions: baseline };
  const result = { ...baseline };
  let mcpAllowedServers: string[] | undefined;
  let customToolAllowedNames: string[] | undefined;
  for (const [kind, value] of Object.entries(overrides) as [
    PermissionKind,
    PermissionOverrideValue,
  ][]) {
    if (value === undefined) continue;
    if (typeof value === 'string') {
      // Scalar decision form
      result[kind] = value as PermissionDecision;
      continue;
    }
    // Object form: allowlist (only valid for mcp / custom-tool)
    if (kind === 'mcp' && 'allowedServers' in value) {
      mcpAllowedServers = value.allowedServers;
      result.mcp = value.allowedServers.length > 0 ? 'allow' : 'deny';
      continue;
    }
    if (kind === 'custom-tool' && 'allowedNames' in value) {
      customToolAllowedNames = value.allowedNames;
      result['custom-tool'] = value.allowedNames.length > 0 ? 'allow' : 'deny';
      continue;
    }
  }
  return {
    decisions: result,
    ...(mcpAllowedServers !== undefined && { mcpAllowedServers }),
    ...(customToolAllowedNames !== undefined && { customToolAllowedNames }),
  };
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
