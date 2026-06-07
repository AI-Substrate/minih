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

/**
 * SDK 0.3.0 PermissionRequest kinds (locked to a string-literal union per
 * Plan 018 finding 01 — drift between SDK minors must surface loudly so
 * we can decide policy on the new kind explicitly).
 */
export type CopilotPermissionKind =
  | 'shell'
  | 'write'
  | 'mcp'
  | 'read'
  | 'url'
  | 'custom-tool'
  | 'memory'
  | 'hook';

/**
 * SDK 0.3.0 PermissionRequest shape (subset minih reads). Full shape lives
 * in `node_modules/@github/copilot-sdk/dist/types.d.ts:579`.
 */
export interface CopilotPermissionRequestLike {
  kind: CopilotPermissionKind;
  toolCallId?: string;
  requestId?: string;
  toolName?: string;
  arguments?: unknown;
}

/**
 * Subset of `PermissionDecisionRequest['result']` that minih actually
 * returns. Full union lives in
 * `node_modules/@github/copilot-sdk/dist/generated/rpc.d.ts:824`.
 */
export type CopilotPermissionDecision =
  | { kind: 'approve-once' }
  | { kind: 'reject'; feedback?: string };

export type CopilotPermissionHandler = (
  request: CopilotPermissionRequestLike,
  invocation: { sessionId: string },
) => CopilotPermissionDecision | Promise<CopilotPermissionDecision>;

export interface CopilotSessionConfig {
  streaming?: boolean;
  model?: string;
  reasoningEffort?: CopilotReasoningEffort;
  workingDirectory?: string;
  configDir?: string;
  mcpServers?: Record<string, unknown>;
  skillDirectories?: string[];
  disabledSkills?: string[];
  onPermissionRequest?: CopilotPermissionHandler;
}

export interface CopilotResumeSessionConfig {
  model?: string;
  reasoningEffort?: CopilotReasoningEffort;
  workingDirectory?: string;
  configDir?: string;
  mcpServers?: Record<string, unknown>;
  skillDirectories?: string[];
  disabledSkills?: string[];
  onPermissionRequest?: CopilotPermissionHandler;
}

export interface ICopilotSession {
  readonly sessionId: string;
  send(options: { prompt: string }): Promise<unknown>;
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
