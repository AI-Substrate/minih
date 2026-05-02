/**
 * minih input-bridge — capability-aware adapter from the human-view footer
 * to the appropriate write channel. Routes typed text either to the SDK
 * conversation (`SessionSender.send`) for non-coordinated runs, or to the
 * outside inbox lane (`appendInboxMessage`) for coordinated runs. Read-only
 * fallback covers both completed runs and cross-process attach to a
 * non-coordinated agent.
 *
 * Owned by Plan 009 Phase 2 (initial). FX008 (Plan 016) widened the
 * capability enum to 5 values + added cross-process inbox write path
 * shared between `run --human` (in-process) and `minih attach` (out-of-process).
 */

import type { SessionSender } from '../../adapter/events.js';
import type { CoordinationRunLocation } from '../../runner/index.js';
import type { LiveRunStatus } from '../../runner/types.js';
import { buildOutsideMessage } from '../commands/outside.js';
import { appendInboxMessage } from '../coordination.js';

export type InputCapability =
  | 'input → inbox'
  | 'input → session'
  | 'input read-only — non-coordinated'
  | 'input read-only — completed'
  | 'completed';

export interface InputBridgeInput {
  /** Run dir — included for traceability/labels. */
  runDir?: string;
  /** Agent slug — for envelope traceability and capability routing. */
  agentSlug?: string;
  /** True when this view is attached cross-process (not the parent of the run). */
  attached: boolean;
  /** Coordination flag from the agent's frontmatter. */
  coordinated?: boolean;
  /** Current run status from the manifest. */
  runStatus: LiveRunStatus;
  /** SDK sender — only present for in-process `run --human` / `resume --human`. */
  sender?: SessionSender;
  /**
   * Coordination run location for inbox writes. Required (with `coordinated: true`)
   * to resolve capability to `'input → inbox'`. Construct via
   * `coordinationRunLocation(slug, agentsDir, runId)`.
   */
  location?: CoordinationRunLocation;
  /**
   * Envelope command name for traceability. Defaults to `'human-tui.input'`
   * (in-process `run --human`); attach overrides to `'attach.input'`.
   */
  commandName?: string;
}

export interface InputSubmitOk {
  ok: true;
  /** Message id — SDK message id for `'input → session'`, ULID for `'input → inbox'`. */
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
  /** Optional human-readable reason — non-empty for read-only and completed. */
  reason?: string;
  /** Submit text from the footer. */
  submit(text: string): Promise<InputSubmitResult>;
  /**
   * Update the bridge's runStatus. When the run flips to `completed`/`failed`,
   * capability transitions to `'input read-only — completed'` and `submit()`
   * starts refusing. Returns the new bridge state (callers swap their reference).
   */
  withRunStatus(runStatus: LiveRunStatus): InputBridge;
}

const TERMINAL_STATUSES: ReadonlySet<LiveRunStatus> = new Set([
  'completed',
  'failed',
] as LiveRunStatus[]);

const SUBJECT_MAX = 60;

/**
 * Synthesise a subject from a body string: first line if multi-line, then
 * truncated to {@link SUBJECT_MAX} chars at the last word boundary.
 */
export function synthesiseSubject(body: string): string {
  const firstLine = body.split(/\r?\n/, 1)[0] ?? '';
  if (firstLine.length <= SUBJECT_MAX) return firstLine;
  const slice = firstLine.slice(0, SUBJECT_MAX);
  const lastSpace = slice.lastIndexOf(' ');
  return lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
}

export function createInputBridge(input: InputBridgeInput): InputBridge {
  const isTerminal = TERMINAL_STATUSES.has(input.runStatus);

  if (isTerminal) {
    return makeRefusingBridge(
      input,
      'input read-only — completed',
      'run completed',
    );
  }

  // Coordinated path: writes append to the outside inbox lane. Available
  // both in-process (run/resume --human) and cross-process (attach).
  // FAIL CLOSED — if `coordinated` is set, never fall through to the SDK
  // path. Coordinated runs require `location` to write the inbox; without
  // it, refuse with a descriptive read-only label so the caller can fix
  // their wiring instead of silently shipping messages to the wrong channel
  // (which is the bug FX001/FX008 was created to prevent — companion F003).
  if (input.coordinated === true) {
    if (input.location === undefined) {
      return makeRefusingBridge(
        input,
        'input read-only — non-coordinated',
        'coordinated run missing inbox location',
      );
    }
    const location = input.location;
    const commandName = input.commandName ?? 'human-tui.input';
    return {
      capability: 'input → inbox',
      submit: async (text: string): Promise<InputSubmitResult> => {
        try {
          const message = buildOutsideMessage({
            type: 'task',
            subject: synthesiseSubject(text),
            body: text,
          });
          appendInboxMessage(commandName, location, 'outside', message);
          return { ok: true, messageId: message.id };
        } catch (err) {
          return {
            ok: false,
            reason: `inbox write failed: ${(err as Error).message}`,
          };
        }
      },
      withRunStatus(nextStatus: LiveRunStatus): InputBridge {
        return createInputBridge({ ...input, runStatus: nextStatus });
      },
    };
  }

  // Non-coordinated same-process: use the SDK conversation channel.
  if (!input.attached && input.sender) {
    const sender = input.sender;
    return {
      capability: 'input → session',
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

  // Cross-process attach to a non-coordinated agent (or coordinated with
  // missing location): read-only fallback. Footer can still render but
  // submit refuses cleanly.
  return makeRefusingBridge(
    input,
    'input read-only — non-coordinated',
    input.attached
      ? 'attached to non-coordinated agent'
      : 'no write channel available',
  );
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
