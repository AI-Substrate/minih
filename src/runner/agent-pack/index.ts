/**
 * Public surface of the agent-pack module — consumed by `cli` (and any
 * future external consumer) via `runner/index.ts` re-exports.
 *
 * Internal helpers stay unexported here.
 */

export type { FetchTarballResult, IAgentPackFetcher } from './fetcher.js';
// Fetcher seam
export {
  FakeAgentPackFetcher,
  GitHubAgentPackFetcher,
} from './fetcher.js';
export type {
  InstallOptions,
  InstallResult,
  InstallSource,
} from './install.js';
// Install orchestration (FX001 — local source path; URL/registry land in Phase 3/4)
export { installAgentPack } from './install.js';
export type { ValidationResult as AgentManifestValidationResult } from './manifest.js';
// Manifest
export {
  AGENT_MANIFEST_FILENAME,
  CANONICAL_AGENT_FILES,
  checkManifestPath,
  RUNTIME_DIR_NAMES,
  readAgentManifest,
  synthesizeImplicitManifest,
  validateManifest,
} from './manifest.js';
// Registry
export {
  listRegistryAgents,
  readRegistryCatalog,
  resolveRegistrySlug,
} from './registry.js';
// Source sidecar
export {
  computeFileChecksums,
  readSourceSidecar,
  SOURCE_SIDECAR_FILENAME,
  verifyChecksums,
  writeSourceSidecar,
} from './source.js';
// Types
export type {
  AgentPackManifest,
  AgentPackManifestFile,
  AgentPackSource,
  InstallAction,
  MinihSourceSidecar,
  ParsedAgentUrl,
  RegistryCatalog,
  RegistryEntry,
} from './types.js';
// URL parser
export { parseAgentUrl, renderAgentUrlCanonical } from './url.js';
