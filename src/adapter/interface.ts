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
  /** Execute a prompt through the agent. */
  run(options: AgentRunOptions): Promise<AgentResult>;

  /** Send compact command to reduce context. */
  compact(sessionId: string): Promise<AgentResult>;

  /** Terminate a running agent session. */
  terminate(sessionId: string): Promise<AgentResult>;
}
