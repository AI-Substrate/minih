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
  configDir?: string;
  mcpServers?: Record<string, unknown>;
  onPermissionRequest?: () => { kind: string };
}

export interface CopilotResumeSessionConfig {
  model?: string;
  reasoningEffort?: CopilotReasoningEffort;
  workingDirectory?: string;
  configDir?: string;
  mcpServers?: Record<string, unknown>;
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

/** Subset of the SDK's ModelInfo shape we use for capability pre-flight. */
export interface CopilotModelInfo {
  id: string;
  capabilities?: {
    supports?: {
      reasoningEffort?: boolean;
    };
  };
  supportedReasoningEfforts?: CopilotReasoningEffort[];
}

export interface ICopilotClient {
  createSession(config?: CopilotSessionConfig): Promise<ICopilotSession>;
  resumeSession(
    sessionId: string,
    config?: CopilotResumeSessionConfig,
  ): Promise<ICopilotSession>;
  start?(): Promise<unknown>;
  listModels?(): Promise<CopilotModelInfo[]>;
  stop(): Promise<unknown>;
}
