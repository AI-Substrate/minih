/**
 * minih input-bridge — capability-aware adapter from the human-view footer to
 * the same-process `SessionSender.send`. Keeps coordination details (the
 * internal `coordination.enabled` gate, attach semantics, lifecycle) hidden
 * behind one of three user-visible labels: `input available`, `input read-only`,
 * `completed`.
 *
 * Owned by Phase 2 plan 009. Public surface is the `InputBridge` interface;
 * Phase 3 may consume it for snapshot-mode footer rendering without modification.
 */

import type { SessionSender } from '../../adapter/events.js';
import type { LiveRunStatus } from '../../runner/types.js';

export type InputCapability =
  | 'input available'
  | 'input read-only'
  | 'completed';

export interface InputBridgeInput {
  /** When provided AND `attached` is false AND run is active → input available. */
  sender?: SessionSender;
  /** True when this view is attached cross-process (not the parent of the run). */
  attached: boolean;
  /** Current run status from the manifest. */
  runStatus: LiveRunStatus;
}

export interface InputSubmitOk {
  ok: true;
  /** Message id returned from the SDK. */
  messageId: string;
}

export interface InputSubmitRefused {
  ok: false;
  reason: string;
}

export type InputSubmitResult = InputSubmitOk | InputSubmitRefused;

export interface InputBridge {
  /** User-visible capability label rendered in the footer. */
  capability: InputCapability;
  /** Optional human-readable reason — non-empty for `input read-only` and `completed`. */
  reason?: string;
  /** Submit text from the footer. */
  submit(text: string): Promise<InputSubmitResult>;
  /**
   * Update the bridge's runStatus. When the run flips to `completed`/`failed`,
   * capability transitions to `completed` and `submit()` starts refusing.
   * Returns the new bridge state (callers swap their reference).
   */
  withRunStatus(runStatus: LiveRunStatus): InputBridge;
}

const TERMINAL_STATUSES: ReadonlySet<LiveRunStatus> = new Set([
  'completed',
  'failed',
] as LiveRunStatus[]);

export function createInputBridge(input: InputBridgeInput): InputBridge {
  const isTerminal = TERMINAL_STATUSES.has(input.runStatus);

  if (isTerminal) {
    return makeRefusingBridge(input, 'completed', 'run completed');
  }

  if (input.attached || !input.sender) {
    return makeRefusingBridge(input, 'input read-only', 'attached-read-only');
  }

  // Active + same-process + sender available → write capability.
  const sender = input.sender;
  return {
    capability: 'input available',
    submit: async (text: string): Promise<InputSubmitResult> => {
      try {
        const messageId = await sender.send(text);
        return { ok: true, messageId };
      } catch (err) {
        return {
          ok: false,
          reason: `send failed: ${(err as Error).message}`,
        };
      }
    },
    withRunStatus(nextStatus: LiveRunStatus): InputBridge {
      return createInputBridge({ ...input, runStatus: nextStatus });
    },
  };
}

function makeRefusingBridge(
  input: InputBridgeInput,
  capability: InputCapability,
  reason: string,
): InputBridge {
  return {
    capability,
    reason,
    submit: async (): Promise<InputSubmitResult> => ({ ok: false, reason }),
    withRunStatus(nextStatus: LiveRunStatus): InputBridge {
      return createInputBridge({ ...input, runStatus: nextStatus });
    },
  };
}
