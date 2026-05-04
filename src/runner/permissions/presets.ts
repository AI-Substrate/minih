/**
 * Six built-in permission presets.
 *
 * Plan 018 R1 / Workshop 001 § Schema. The decision matrix below is the
 * baseline-loosening reference: you should rarely need to change these
 * values without an explicit ADR. Each preset is exported as a frozen
 * record so accidental mutation by callers throws.
 *
 *   - yolo:       allow everything (legacy default — flips at R6)
 *   - trusted:    allow shell/read/write/mcp/url; deny memory/hook/custom
 *   - restricted: allow read+mcp only; deny shell/write/url/memory/hook/custom
 *   - read-only:  allow read+mcp only (alias of restricted, but no shell/write *escape* — see overrides)
 *   - network:    restricted + allow url
 *   - build-only: trusted minus url+mcp (no network)
 */

import type {
  PermissionDecision,
  PermissionKind,
  PermissionPresetName,
} from './policy.js';

/** Internal helper — produce a record mapping every kind to one decision. */
function uniformDecision(
  decision: PermissionDecision,
): Record<PermissionKind, PermissionDecision> {
  return {
    shell: decision,
    write: decision,
    mcp: decision,
    read: decision,
    url: decision,
    'custom-tool': decision,
    memory: decision,
    hook: decision,
  };
}

const yolo: Record<PermissionKind, PermissionDecision> =
  uniformDecision('allow');

const trusted: Record<PermissionKind, PermissionDecision> = {
  shell: 'allow',
  write: 'allow',
  mcp: 'allow',
  read: 'allow',
  url: 'allow',
  'custom-tool': 'deny',
  memory: 'deny',
  hook: 'deny',
};

const restricted: Record<PermissionKind, PermissionDecision> = {
  shell: 'deny',
  write: 'deny',
  mcp: 'allow',
  read: 'allow',
  url: 'deny',
  'custom-tool': 'deny',
  memory: 'deny',
  hook: 'deny',
};

// read-only is restricted — included for ergonomic naming. Callers who want
// "read but no exec" pick this; callers who want "fully sandboxed; only mcp"
// pick restricted. Both share the same decision matrix.
const readOnly: Record<PermissionKind, PermissionDecision> = { ...restricted };

const network: Record<PermissionKind, PermissionDecision> = {
  ...restricted,
  url: 'allow',
};

const buildOnly: Record<PermissionKind, PermissionDecision> = {
  shell: 'allow',
  write: 'allow',
  mcp: 'deny',
  read: 'allow',
  url: 'deny',
  'custom-tool': 'deny',
  memory: 'deny',
  hook: 'deny',
};

const PRESETS = Object.freeze({
  yolo: Object.freeze(yolo),
  trusted: Object.freeze(trusted),
  restricted: Object.freeze(restricted),
  'read-only': Object.freeze(readOnly),
  network: Object.freeze(network),
  'build-only': Object.freeze(buildOnly),
}) as Readonly<
  Record<
    PermissionPresetName,
    Readonly<Record<PermissionKind, PermissionDecision>>
  >
>;

export class UnknownPresetError extends Error {
  constructor(name: string) {
    super(
      `Unknown permission preset "${name}". Valid presets: ${Object.keys(PRESETS).join(', ')}`,
    );
    this.name = 'UnknownPresetError';
  }
}

/**
 * Look up a preset's decision matrix. Throws `UnknownPresetError` for
 * unknown names — callers should validate frontmatter early so users see a
 * clear error before runtime resolution.
 */
export function getPreset(
  name: PermissionPresetName,
): Readonly<Record<PermissionKind, PermissionDecision>> {
  const preset = PRESETS[name];
  if (!preset) throw new UnknownPresetError(name);
  return preset;
}

/** All preset names, exported for `agent permissions list-available`. */
export function listPresetNames(): readonly PermissionPresetName[] {
  return Object.keys(PRESETS) as PermissionPresetName[];
}

/** True iff `name` is a known preset. Used by frontmatter validators. */
export function isPresetName(name: string): name is PermissionPresetName {
  return name in PRESETS;
}

/**
 * Plan 018 R6 (T-R6.1) — flipped from `'yolo'` to `'restricted'`. Sidecar
 * `lockedDefault` overrides this for grandfathered agents (lossless preservation),
 * so existing installs keep their original `yolo` policy. New `init`-scaffolded
 * agents and new `agent install` results without manifest recommendations get
 * `restricted` from this point forward.
 */
export const minihReleaseDefault: PermissionPresetName = 'restricted';
