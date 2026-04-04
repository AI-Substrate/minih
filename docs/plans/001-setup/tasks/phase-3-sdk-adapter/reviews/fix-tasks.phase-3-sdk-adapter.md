# Fix Tasks: Phase 3: SDK Adapter

Apply in order. Re-run review after fixes.

## Critical / High Fixes

### FT-001: Emit `session_start` for real SDK sessions
- **Severity**: HIGH
- **File(s)**: /Users/jordanknight/substrate/minih/src/adapter/sdk-copilot.ts
- **Issue**: `SdkCopilotAdapter.run()` creates or resumes the SDK session but never emits `session_start`. The runner timeout path only captures the active session ID from that event, so timed-out real SDK runs currently fall back to `terminate('')`.
- **Fix**: Emit a synthetic `session_start` `AgentEvent` immediately after `createSession()` / `resumeSession()` succeeds and before `sendAndWait()` begins.
- **Patch hint**:
  ```diff
    const session = sessionId
      ? await this._client.resumeSession(sessionId, { ... })
      : await this._client.createSession({ ... });
  
  + if (onEvent) {
  +   onEvent({
  +     type: 'session_start',
  +     timestamp: new Date().toISOString(),
  +     data: { sessionId: session.sessionId },
  +   });
  + }
  +
      session.on((event) => {
        ...
      });
  ```

## Medium / Low Fixes

### FT-002: Pass `cwd` through as SDK `workingDirectory`
- **Severity**: MEDIUM
- **File(s)**: /Users/jordanknight/substrate/minih/src/adapter/copilot-types.ts, /Users/jordanknight/substrate/minih/src/adapter/sdk-copilot.ts
- **Issue**: The installed SDK supports `workingDirectory`, but the local Copilot config facade omits it and `run()` drops `AgentRunOptions.cwd`.
- **Fix**: Add `workingDirectory?: string` to `CopilotSessionConfig` and `CopilotResumeSessionConfig`, then pass `options.cwd` through on both `createSession()` and `resumeSession()`.
- **Patch hint**:
  ```diff
   export interface CopilotSessionConfig {
     streaming?: boolean;
     model?: string;
     reasoningEffort?: CopilotReasoningEffort;
  +  workingDirectory?: string;
     onPermissionRequest?: () => { kind: string };
   }
   
   export interface CopilotResumeSessionConfig {
     model?: string;
     reasoningEffort?: CopilotReasoningEffort;
  +  workingDirectory?: string;
     onPermissionRequest?: () => { kind: string };
   }
  ```
  ```diff
       ? await this._client.resumeSession(sessionId, {
           onPermissionRequest: approveAll,
  +        ...(options.cwd && { workingDirectory: options.cwd }),
           ...(model && { model }),
           ...(reasoningEffort && { reasoningEffort }),
         })
       : await this._client.createSession({
           streaming: !!onEvent,
           onPermissionRequest: approveAll,
  +        ...(options.cwd && { workingDirectory: options.cwd }),
           ...(model && { model }),
           ...(reasoningEffort && { reasoningEffort }),
         });
  ```

### FT-003: Preserve full tool-completion output
- **Severity**: MEDIUM
- **File(s)**: /Users/jordanknight/substrate/minih/src/adapter/sdk-copilot.ts
- **Issue**: `tool.execution_complete` translation only uses `result.content`, so failed tool calls and diff-heavy tool output lose `error.message` and `detailedContent`.
- **Fix**: Build `tool_result.output` from the richest available field: `detailedContent`, then `content`, then `error.message`.
- **Patch hint**:
  ```diff
     case 'tool.execution_complete':
       return {
         type: 'tool_result',
         timestamp,
         data: {
           toolCallId: event.data?.toolCallId ?? '',
  -        output: event.data?.result?.content ?? '',
  +        output:
  +          event.data?.result?.detailedContent ??
  +          event.data?.result?.content ??
  +          event.data?.error?.message ??
  +          '',
           isError: !event.data?.success,
         },
       };
  ```

### FT-004: Disconnect resumed sessions after `/compact`
- **Severity**: LOW
- **File(s)**: /Users/jordanknight/substrate/minih/src/adapter/copilot-types.ts, /Users/jordanknight/substrate/minih/src/adapter/sdk-copilot.ts
- **Issue**: `compact()` resumes a session and returns without cleanup. The SDK documents `disconnect()` as the supported cleanup path, but the local facade does not expose it.
- **Fix**: Add `disconnect(): Promise<void>` to `ICopilotSession` and call it from a `finally` block after `/compact` completes. Session state is preserved for later resumption by `sessionId`.
- **Patch hint**:
  ```diff
   export interface ICopilotSession {
     readonly sessionId: string;
     sendAndWait(options: { prompt: string }, timeout?: number): Promise<unknown>;
     on(handler: (event: CopilotSessionEventLike) => void): () => void;
     abort(): Promise<void>;
  +  disconnect(): Promise<void>;
     destroy(): Promise<void>;
   }
  ```
  ```diff
   async compact(sessionId: string): Promise<AgentResult> {
     const session = await this._client.resumeSession(sessionId, {
       onPermissionRequest: approveAll,
     });
   
     try {
       ...
     } catch (error) {
       ...
+    } finally {
+      await session.disconnect();
     }
   }
  ```

### FT-005: Refresh adapter domain documentation
- **Severity**: LOW
- **File(s)**: /Users/jordanknight/substrate/minih/docs/domains/adapter/domain.md
- **Issue**: The Phase 3 history row was added, but the rest of the doc still omits `copilot-types.ts`, the expanded adapter barrel surface, and a concept entry for the local Copilot SDK facade.
- **Fix**: Update `## Composition`, `## Contracts`, and `## Concepts` so the doc reflects the Phase 3 public surface.
- **Patch hint**:
  ```diff
   | `src/adapter/fake.ts` | internal | FakeAgentAdapter test double |
  +| `src/adapter/copilot-types.ts` | contract | Local Copilot SDK facade types used by SdkCopilotAdapter |
   | `src/adapter/sdk-copilot.ts` | internal | SdkCopilotAdapter (Phase 3) |
   | `src/adapter/index.ts` | contract | Barrel export |
   
   | `AgentRunOptions` | Type | runner (adapter invocation) |
  +| `SdkCopilotAdapter` | Class | cli (composition root), external programmatic consumers |
  +| `ICopilotClient` / `ICopilotSession` | Interface | cli (SDK client wiring), adapter tests/fakes |
   
   | Event translation | SDK-specific events mapped to stable AgentEvent union so consumers never see SDK internals. |
  +| Local Copilot facade | `copilot-types.ts` defines the subset of SDK config/session/client types the adapter depends on, so the rest of minih avoids SDK internals. |
  ```

## Re-Review Checklist

- [ ] `session_start` is emitted before `sendAndWait()` for real SDK sessions
- [ ] `AgentRunOptions.cwd` reaches the SDK as `workingDirectory`
- [ ] `tool_result` preserves `detailedContent` / `error.message`
- [ ] `compact()` disconnects the resumed session after completion
- [ ] `adapter/domain.md` reflects `copilot-types.ts` and the Phase 3 public facade surface
- [ ] Re-run `/plan-7-v2-code-review` and achieve zero HIGH/CRITICAL
