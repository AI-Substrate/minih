/**
 * Local interface types for Copilot SDK integration.
 *
 * These mirror the subset of @github/copilot-sdk we actually use.
 * The adapter depends on these, not the SDK types directly — this
 * enables testing without SDK runtime and provides layer isolation.
 *
 * Kept minimal: only the methods/shapes SdkCopilotAdapter touches.
 */

export type CopilotReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

/** Permissive event shape — real SDK has 30+ event types. */
export interface CopilotSessionEventLike {
  type: string;
  // biome-ignore lint/suspicious/noExplicitAny: SDK events have varied data shapes
  data?: any;
}

export interface CopilotSessionConfig {
  streaming?: boolean;
  model?: string;
  reasoningEffort?: CopilotReasoningEffort;
  workingDirectory?: string;
  onPermissionRequest?: () => { kind: string };
}

export interface CopilotResumeSessionConfig {
  model?: string;
  reasoningEffort?: CopilotReasoningEffort;
  workingDirectory?: string;
  onPermissionRequest?: () => { kind: string };
}

export interface ICopilotSession {
  readonly sessionId: string;
  sendAndWait(options: { prompt: string }, timeout?: number): Promise<unknown>;
  on(handler: (event: CopilotSessionEventLike) => void): () => void;
  abort(): Promise<void>;
  disconnect(): Promise<void>;
  destroy(): Promise<void>;
}

export interface ICopilotClient {
  createSession(config?: CopilotSessionConfig): Promise<ICopilotSession>;
  resumeSession(
    sessionId: string,
    config?: CopilotResumeSessionConfig,
  ): Promise<ICopilotSession>;
  stop(): Promise<unknown>;
}
