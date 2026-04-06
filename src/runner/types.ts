/**
 * Runner types — data structures for agent definitions, run config, and results.
 *
 * Extracted from: harness/src/agent/types.ts
 * Adapted: Added description + tags to AgentDefinition (frontmatter support).
 *          Removed HarnessEnvelope import.
 */

import type { AgentResult } from '../adapter/events.js';

/** An agent definition discovered from the agents/ folder. */
export interface AgentDefinition {
  slug: string;
  /** One-line description from prompt.md frontmatter */
  description: string;
  /** Tags from prompt.md frontmatter */
  tags: string[];
  /** Default model from prompt.md frontmatter (overridable via --model) */
  model?: string;
  /** Default reasoning effort from prompt.md frontmatter (overridable via --reasoning) */
  reasoning?: string;
  /** Default timeout in seconds from prompt.md frontmatter (overridable via --timeout) */
  timeout?: number;
  dir: string;
  promptPath: string;
  schemaPath: string | null;
  instructionsPath: string | null;
  inputSchemaPath: string | null;
}

/** Configuration for a single agent run. */
export interface AgentRunConfig {
  slug: string;
  model?: string;
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
  timeout?: number;
  cwd?: string;
  params?: Record<string, string>;
  /** Session ID to resume — if set, uses resumeSession() instead of createSession() */
  sessionId?: string;
  /** Run ID of the original run being resumed */
  resumedFromRunId?: string;
  /** Override the prompt text (used by resume — sends follow-up message instead of prompt.md) */
  promptOverride?: string;
}

/** Validation result from JSON Schema check. */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Metadata written to completed.json after each run. */
export interface CompletedMetadata {
  slug: string;
  runId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  sessionId: string;
  result: 'completed' | 'failed' | 'timeout' | 'degraded';
  exitCode: number;
  validated: boolean | null;
  validationErrors: string[];
  /** Did system output fields (summary + retrospective) pass? */
  systemValidated: boolean;
  /** Did user schema pass? null if no output-schema.json */
  userValidated: boolean | null;
  eventCount: number;
  toolCallCount: number;
  artifacts: string[];
  /** Run ID of the original run, if this is a resumed session */
  resumedFromRunId?: string;
}

/** Result returned from the runner to the CLI command. */
export interface AgentRunResult {
  agentResult: AgentResult;
  metadata: CompletedMetadata;
  validation: ValidationResult | null;
  runDir: string;
}

/** Events collected during a run, for counting and analysis. */
export interface RunEventStats {
  total: number;
  toolCalls: number;
  toolResults: number;
  messages: number;
  thinking: number;
  errors: number;
}
