/**
 * Permission handler factory — Plan 018 R1.
 *
 * Maps a `ResolvedPolicy` to the SDK's `PermissionHandler` shape.
 *
 * Workshop 001 § Schema + Workshop 002 § Q4 (idempotency on requestId).
 *
 * Domain: runner. Pure — no side effects beyond the optional `onDeny`
 * callback (used by sdk-copilot adapter to emit `permission_denied` events
 * and trigger the 5-signal denial protocol).
 */

import { extractPathArg, isPathAllowed } from './fs-guard.js';
import type {
  PermissionDecision,
  PermissionKind,
  ResolvedPolicy,
} from './policy.js';

/**
 * SDK 0.3.0 `PermissionRequest` shape (kept here as a structural type so
 * we don't import from `@github/copilot-sdk` outside the adapter domain).
 */
export interface SdkPermissionRequestLike {
  kind: PermissionKind;
  toolCallId?: string;
  requestId?: string;
  toolName?: string;
  arguments?: unknown;
}

/**
 * SDK 0.3.0 `PermissionDecision` union (subset minih emits — full union is
 * in `node_modules/@github/copilot-sdk/dist/generated/rpc.d.ts:824`).
 */
export type SdkPermissionDecision =
  | { kind: 'approve-once' }
  | { kind: 'reject'; feedback?: string };

/** Reason payload passed to `onDeny`. Used by the 5-signal denial chain. */
export interface PermissionDenialReason {
  kind: PermissionKind;
  decision: PermissionDecision;
  toolName?: string;
  attemptedPath?: string;
  requestId?: string;
  toolCallId?: string;
  message: string;
}

export interface PermissionHandlerCallbacks {
  /**
   * Invoked exactly once per unique requestId per denial. Idempotent —
   * second invocation with the same requestId is a no-op.
   */
  onDeny?: (reason: PermissionDenialReason) => void;
}

/**
 * Build a `PermissionHandler` for the given resolved policy.
 *
 * Returned function shape matches the SDK 0.3.0 `PermissionHandler` type
 * (request, invocation) → decision.
 *
 * Behaviour:
 *   - Look up `kind` decision in `policy.decisions`.
 *   - If decision is `deny` → emit denial signal (idempotent), return
 *     `{kind: 'reject', feedback}`.
 *   - If decision is `allow`, AND kind is path-bearing (write/read/shell),
 *     extract path from arguments and call `isPathAllowed`. If outside
 *     roots → emit denial, return reject.
 *   - Otherwise → `{kind: 'approve-once'}`.
 */
export function buildPermissionHandler(
  policy: ResolvedPolicy,
  callbacks: PermissionHandlerCallbacks = {},
): (
  request: SdkPermissionRequestLike,
  invocation: { sessionId: string },
) => SdkPermissionDecision {
  const onDeny = callbacks.onDeny;

  // Idempotency set — closure-scoped so each handler instance has its own.
  const deniedRequestIds = new Set<string>();

  function denyOnce(reason: PermissionDenialReason): SdkPermissionDecision {
    const id = reason.requestId ?? reason.toolCallId ?? '';
    if (id && deniedRequestIds.has(id)) {
      return { kind: 'reject', feedback: reason.message };
    }
    if (id) deniedRequestIds.add(id);
    if (onDeny) {
      try {
        onDeny(reason);
      } catch {
        // Hooks must not derail the handler. Workshop 002 § Q1 mandates
        // signal failures recorded; swallow here so the denial decision
        // still reaches the SDK.
      }
    }
    return { kind: 'reject', feedback: reason.message };
  }

  return function permissionHandler(
    request: SdkPermissionRequestLike,
    _invocation: { sessionId: string },
  ): SdkPermissionDecision {
    const kind = request.kind;
    const decision = policy.decisions[kind];

    if (decision === 'deny') {
      return denyOnce({
        kind,
        decision: 'deny',
        toolName: request.toolName,
        requestId: request.requestId,
        toolCallId: request.toolCallId,
        message: `permission denied: kind=${kind} blocked by preset/overrides`,
      });
    }

    if (decision === 'prompt-user') {
      // Reserved for FX002 (`permissions check`). For R1-R6 treat as deny.
      return denyOnce({
        kind,
        decision: 'prompt-user',
        toolName: request.toolName,
        requestId: request.requestId,
        toolCallId: request.toolCallId,
        message: `permission requires user prompt (FX002 not yet implemented): kind=${kind}`,
      });
    }

    // decision === 'allow'. For path-bearing kinds, also check the path.
    if (kind === 'write' || kind === 'read' || kind === 'shell') {
      const candidatePath = extractPathArg(
        request.toolName ?? kind,
        request.arguments,
      );
      if (
        candidatePath &&
        !isPathAllowed(candidatePath, policy.canonicalRoots)
      ) {
        return denyOnce({
          kind,
          decision: 'deny',
          toolName: request.toolName,
          attemptedPath: candidatePath,
          requestId: request.requestId,
          toolCallId: request.toolCallId,
          message:
            `permission denied: ${kind} attempt on "${candidatePath}" is outside allowedRoots ` +
            `[${policy.canonicalRoots.join(', ')}]`,
        });
      }
    }

    return { kind: 'approve-once' };
  };
}
