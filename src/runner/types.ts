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
