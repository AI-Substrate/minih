/**
 * Public surface for the permissions module — Plan 018 R1.
 *
 * Domain: runner. Other domains (cli, adapter, mcp) MUST import from this
 * file rather than reaching into individual files.
 */

export {
  buildPresetCatalog,
  formatCatalogAsTable,
  type PresetCatalogEntry,
} from './catalog.js';
export { compile } from './compile.js';
export {
  assertCoordWriteAllowed,
  CoordinationWriteDeniedError,
  type CoordWritePreconditionOptions,
  formatCoordWriteDeniedMessage,
  isCoordWritePreconditionDisabled,
} from './coord-write-precondition.js';
export {
  buildPermissionErrorPayload,
  type DenialState,
  type FireDenialOptions,
  fireTerminalDenial,
  type PermissionErrorPayload,
} from './error-signal.js';
export {
  AllowedRootsInvalidError,
  canonicalizeRoots,
  extractPathArg,
  ForbiddenRootError,
  isPathAllowed,
  resolveDefaultAllowedRoots,
} from './fs-guard.js';
export {
  buildPermissionHandler,
  type PermissionDenialReason,
  type PermissionDeniedKind,
  type PermissionHandlerCallbacks,
  type SdkPermissionDecision,
  type SdkPermissionRequestLike,
} from './handler.js';
export type {
  AllowedRootsRule,
  PermissionDecision,
  PermissionKind,
  PermissionOverrides,
  PermissionPolicy,
  PermissionPresetName,
  PolicySources,
  ResolvedPolicy,
  RootProvenance,
} from './policy.js';
export { ALL_PERMISSION_KINDS } from './policy.js';
export {
  getPreset,
  isPresetName,
  listPresetNames,
  minihReleaseDefault,
  UnknownPresetError,
} from './presets.js';
