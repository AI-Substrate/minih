/**
 * minih — Standalone declarative agent runner with self-improving feedback.
 *
 * Public API re-exports for programmatic usage.
 */

// Adapter domain
export type {
  AgentEvent,
  AgentEventHandler,
  AgentResult,
  AgentRunOptions,
  AgentStatus,
  IAgentAdapter,
  ReasoningEffort,
  TokenMetrics,
} from './adapter/index.js';

export { FakeAgentAdapter } from './adapter/index.js';

// Runner domain
export type {
  AgentDefinition,
  AgentRunConfig,
  AgentRunResult,
  CompletedMetadata,
  RunEventStats,
  ValidationResult,
} from './runner/index.js';
