// Plan 017 — agent-pack module (install/info/list/remove + manifest/registry/sidecar/fetcher)

export type {
  AgentManifestValidationResult,
  AgentPackManifest,
  AgentPackManifestFile,
  AgentPackSource,
  ExtractOptions,
  ExtractTarballResult,
  FetchTarballResult,
  GitHubAgentPackFetcherOptions,
  IAgentPackFetcher,
  InstallAction,
  InstallOptions,
  InstallResult,
  InstallSource,
  MinihSourceSidecar,
  ParsedAgentUrl,
  RegistryCatalog,
  RegistryEntry,
} from './agent-pack/index.js';
export {
  AGENT_MANIFEST_FILENAME,
  CANONICAL_AGENT_FILES,
  checkManifestPath,
  computeFileChecksums,
  extractTarball,
  FakeAgentPackFetcher,
  GitHubAgentPackFetcher,
  installAgentPack,
  listRegistryAgents,
  parseAgentUrl,
  RUNTIME_DIR_NAMES,
  readAgentManifest,
  readRegistryCatalog,
  readSourceSidecar,
  renderAgentUrlCanonical,
  resolveRegistrySlug,
  SOURCE_SIDECAR_FILENAME,
  synthesizeImplicitManifest,
  validateManifest,
  verifyChecksums,
  writeSourceSidecar,
} from './agent-pack/index.js';
export {
  AtomicWriteCrossFsError,
  writeFileAtomic,
  writeFileAtomicAsync,
} from './atomic-write.js';
export type { CoordinationEnv } from './context.js';
export {
  detectContext,
  getCoordinationEnv,
  MINIH_ENV_KEYS_ALL,
  MINIH_ENV_KEYS_COORDINATION,
} from './context.js';
export {
  displayEvent,
  displayHeader,
  displayPreflight,
  displaySummary,
  formatEvent,
} from './display.js';
export type { WaitForAnyOptions } from './event-wait.js';
export {
  EventWaitInboxCorruptError,
  StateFileCorruptError,
  SUPPORTED_EVENT_KINDS,
  waitForAny,
} from './event-wait.js';
export type { CoordinationRunLocation, RunSession } from './folder.js';
export {
  coordinationRunDir,
  coordinationRunLocation,
  createRunFolder,
  findRunSession,
  hasOutsideMd,
  historyPath,
  InvalidCoordinationFrontmatterError,
  InvalidSlugError,
  inboxLanePath,
  listAgents,
  loadMcpConfig,
  OutsideAgentsDirError,
  outsideMdPath,
  parseFrontmatter,
  resolveAgent,
  stateFilePath,
  validateSlug,
  watermarkPath,
} from './folder.js';
export {
  ManifestSchemaVersionError,
  MultipleActiveRunsError,
} from './human-view-errors.js';
export type { HumanViewSources } from './human-view-model.js';
export { buildHumanViewModel } from './human-view-model.js';
export type {
  InboxPollErrorCode,
  PollInboxOptions,
  PollInboxResult,
  PollInboxWait,
} from './inbox-poll.js';
export { InboxPollError, pollInboxLane } from './inbox-poll.js';
export type {
  ForbiddenMeasurementView,
  FrameworkMapping,
  MeasurementAuthority,
  MeasurementAuthorityContract,
  MeasurementDataStatus,
  MeasurementFramework,
  MeasurementRedactionContract,
  MeasurementSchemaVersion,
  MetricCategory,
  MetricDefinition,
  MetricTraceability,
  MetricTraceabilityLevel,
  MissingDataReason,
  ProofArtifact,
  ProofArtifactKind,
  ProofEvaluation,
  ProofEvaluationInput,
  ProofLevel,
  ProofLevelDefinition,
  ProofRequirement,
  RedactionPosture,
  TaskKind,
} from './measurement/index.js';
export {
  compareProofLevels,
  evaluateProof,
  FORBIDDEN_MEASUREMENT_VIEWS,
  getDefaultProofRequirement,
  getMetricDefinition,
  getProofLevelDefinition,
  isForbiddenMeasurementView,
  listMetricDefinitions,
  listMetricsByCategory,
  MEASUREMENT_AUTHORITY_CONTRACTS,
  MEASUREMENT_DATA_STATUSES,
  MEASUREMENT_SCHEMA_VERSION,
  METRIC_REGISTRY,
  MISSING_DATA_REASONS,
  meetsDefaultValidatedThreshold,
  PROOF_LEVEL_DEFINITIONS,
  PROOF_LEVELS,
  REDACTION_POSTURE_CONTRACTS,
  TRACEABILITY_LEVELS,
} from './measurement/index.js';
export type {
  DerivePeerActivityOptions,
  DerivePeerInputs,
  PeerActivity,
  PeerVerdict,
} from './peer-activity.js';
export {
  computeWillMatch,
  derivePeerActivity,
  derivePeerVerdict,
} from './peer-activity.js';
// Plan 018 — permissions module
export type {
  AllowedRootsRule,
  PermissionDecision,
  PermissionKind,
  PermissionOverrides,
  PermissionPolicy,
  PermissionPresetName,
  PolicySources,
  PresetCatalogEntry,
  ResolvedPolicy,
  RootProvenance,
} from './permissions/index.js';
export {
  ALL_PERMISSION_KINDS,
  AllowedRootsInvalidError,
  buildPermissionHandler,
  buildPresetCatalog,
  canonicalizeRoots,
  compile as compilePermissionPolicy,
  extractPathArg,
  ForbiddenRootError,
  formatCatalogAsTable,
  getPreset,
  isPathAllowed,
  isPresetName,
  listPresetNames,
  minihReleaseDefault,
  resolveDefaultAllowedRoots,
  UnknownPresetError,
} from './permissions/index.js';
export type { PreambleAssemblyInput } from './preamble-builder.js';
export { buildInsidePreamble } from './preamble-builder.js';
export { PrettyDisplay } from './pretty.js';
// Plan 018 — probe module
export type {
  AggregateReportOptions,
  ProbeMatrix,
  ProbeOutcome,
  ProbeReport,
  ScenarioDefinition,
} from './probe/index.js';
export { aggregateReport, buildMatrix } from './probe/index.js';
export type {
  AcquireLockOptions,
  AcquireLockResult,
  ResumeLockContent,
  ResumeLockKind,
  WaitForLockOptions,
  WaitForLockResult,
} from './resume-lock.js';
export {
  acquireResumeLock,
  clearResumeLock,
  readResumeLock,
  waitForResumeLock,
} from './resume-lock.js';
export type {
  AppendRetroEntryArgs,
  AppendRetroStubArgs,
  RetroResult,
  RetrospectiveLike,
} from './retro-ledger.js';
export {
  appendRetroEntry,
  appendRetroStub,
  RetroLedgerError,
} from './retro-ledger.js';
export type {
  DetectRunStateOptions,
  RunEligibilityState,
} from './run-eligibility.js';
export {
  detectRunState,
  isProcessAliveDefault,
} from './run-eligibility.js';
export type {
  GetRunStatusesInput,
  ListRunInventoryInput,
} from './run-inventory.js';
export {
  getRunStatuses,
  listRunInventory,
  summarizeStatusRows,
} from './run-inventory.js';
export { RUN_LOCK_HELD, RunLockHeldError } from './run-lock.js';
export {
  flushThrottled as flushManifestThrottled,
  readManifest,
  updateManifest,
  writeManifest,
} from './run-manifest.js';
export type { RunLabelValidationResult } from './run-params-summary.js';
export {
  buildRunParamsSummary,
  validateRunLabel,
} from './run-params-summary.js';
export type { ResolveRunInput } from './run-resolver.js';
export {
  listActiveRunCandidates,
  resolveRun,
  resolveRunWithDiagnostics,
} from './run-resolver.js';
export {
  computeVelocity,
  MINIH_ENV_KEYS,
  runAgent,
  SYSTEM_OUTPUT_INSTRUCTIONS,
} from './runner.js';
export {
  appendHistory,
  HistoryLineTooLargeError,
  readStateLazy,
  StateCorruptError,
  writeState,
} from './state.js';
export type {
  // Human View — Phase 1 contracts (plan 009-human-agent-view).
  ActiveRunCandidate,
  AgentDefinition,
  AgentRunConfig,
  AgentRunResult,
  CompletedMetadata,
  ControlTimelineEntry,
  CoordinationFrontmatter,
  CoordinationTimelineEntry,
  DiagnosticTimelineEntry,
  EventEnvelope,
  EventKind,
  HumanHeaderView,
  HumanViewModel,
  InboxMessage,
  InboxTimelineEntry,
  InputFooterView,
  InsideMcpServerFactoryContext,
  InsideState,
  LiveRunManifest,
  LiveRunStatus,
  OutputPaneView,
  OutsideState,
  ParsedReport,
  ResolvedRun,
  ResolverDiagnostic,
  RunEventStats,
  RunInventoryRow,
  RunLiveness,
  RunParamsSummary,
  RunResolveMode,
  RunStatusRow,
  Side,
  SideState,
  StateHistoryEntry,
  StatePaneView,
  StateTransitionTimelineEntry,
  ToolCallView,
  TranscriptEntry,
  ValidationResult,
  ValidationTimelineEntry,
  VelocityData,
  ViewDiagnostic,
  WaitForAnyResult,
  WatchEntry,
} from './types.js';
export { ulid } from './ulid.js';
export {
  validateInput,
  validateOutput,
  validateSystemOutput,
} from './validator.js';
