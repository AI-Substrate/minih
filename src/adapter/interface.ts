/**
 * IAgentAdapter — the contract between the runner and any LLM backend.
 *
 * The runner is adapter-agnostic. It calls adapter.run() with a prompt
 * and gets back an AgentResult. Tests inject FakeAgentAdapter.
 * Production uses SdkCopilotAdapter (Phase 3).
 *
 * Extracted from: packages/shared/src/interfaces/agent-adapter.interface.ts
 */

import type { AgentResult, AgentRunOptions } from './events.js';

export interface IAgentAdapter {
  /**
   * Execute a prompt through the agent.
   *
   * The event-driven run contract resolves when the SDK session emits
   * `session_idle` and the caller has no more queued `session.send` work.
   * If `session_error` fires before idle, implementations return an
   * `AgentResult` with `status: 'failed'` instead of throwing or hanging.
   *
   * Implementations that expose a live session handle invoke
   * `options.onSessionReady` once the initial prompt has been sent.
   */
  run(options: AgentRunOptions): Promise<AgentResult>;

  /** Send compact command to reduce context. */
  compact(sessionId: string): Promise<AgentResult>;

  /** Terminate a running agent session. */
  terminate(sessionId: string): Promise<AgentResult>;
}
