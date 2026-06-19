import * as fs from 'node:fs';
import * as path from 'node:path';
import { coordinationRunLocation, inboxLanePath } from '../../runner/folder.js';
import {
  InboxPollError,
  type PollInboxOptions,
  pollInboxLane,
} from '../../runner/inbox-poll.js';
import type { InboxMessage, Side } from '../../runner/types.js';
import { ulid } from '../../runner/ulid.js';
import {
  addSpanAttributes,
  coordinationMessagesSent,
  getTraceparent,
  isVerboseEnabled,
} from '../../telemetry/index.js';
import type { McpServerContext } from '../context.js';
import {
  type InboxListInput,
  jsonResult,
  MAX_INBOX_WAIT_MS,
  McpToolError,
  type McpToolResult,
} from '../types.js';

export interface InboxListOutput {
  messages: InboxMessage[];
  nextAfter: string | null;
  wait?: InboxListWait;
}

export interface InboxListWait {
  requestedMs: number;
  elapsedMs: number;
  timedOut: boolean;
  matched: boolean;
}

export interface InboxSendOutput {
  message: InboxMessage;
}

export interface InboxAckOutput {
  acked: true;
  alreadyAcked: boolean;
  msgId: string;
  ack?: InboxMessage;
}

export async function inboxList(
  context: McpServerContext,
  input: Record<string, unknown> = {},
): Promise<McpToolResult<InboxListOutput>> {
  const listInput = parseInboxListInput(input);
  const pollOptions: PollInboxOptions = {
    type: listInput.type,
    waitForAny: listInput.waitForAny,
    unread: listInput.unread,
    after: listInput.after,
    limit: listInput.limit,
    waitMs: listInput.waitMs,
    maxWaitMs: MAX_INBOX_WAIT_MS,
  };
  try {
    const result = await pollInboxLane(
      coordinationRunLocationFromContext(context),
      'outside',
      pollOptions,
    );
    return jsonResult(result);
  } catch (error) {
    throw mapPollError(error);
  }
}

function mapPollError(error: unknown): McpToolError {
  if (error instanceof InboxPollError) {
    if (error.code === 'INBOX_POLL_INVALID_ARGUMENT') {
      return new McpToolError('MCP_INVALID_ARGUMENT', error.message);
    }
    if (error.code === 'INBOX_POLL_CORRUPT') {
      return new McpToolError('MCP_INBOX_CORRUPT', error.message);
    }
    return new McpToolError('MCP_INTERNAL_ERROR', error.message);
  }
  if (error instanceof McpToolError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new McpToolError('MCP_INTERNAL_ERROR', message);
}

export function inboxSend(
  context: McpServerContext,
  input: Record<string, unknown>,
): McpToolResult<InboxSendOutput> {
  const subject = requireNonEmptyString(input.subject, 'subject');
  const body = requireNonEmptyString(input.body, 'body');
  const type = optionalNonEmptyString(input.type, 'type') ?? 'note';
  const ackOf = parseOptionalAckOf(input.ackOf);
  const message: InboxMessage = {
    id: ulid(),
    sender: 'inside',
    type,
    subject,
    body,
    ts: new Date().toISOString(),
  };
  if (input.meta !== undefined)
    message.meta = requireRecord(input.meta, 'meta');
  // ackOf is accepted optimistically: we validate shape (non-empty string ≤128 chars)
  // but do NOT verify the referenced message exists. A stale ackOf becomes the agent's
  // bug to fix at the human-view rendering layer, not a write-time blocker. Same-lane
  // (inside-acks-inside) is intentionally allowed for thread continuation.
  if (ackOf !== undefined) message.ackOf = ackOf;

  const traceparent = getTraceparent();
  if (traceparent !== undefined) message.traceparent = traceparent;

  appendMessage(lanePath(context, 'inside'), message);
  coordinationMessagesSent.add(1, { type: message.type, sender: 'inside' });
  // Enrich the active minih.mcp.inbox_send dispatch span with message content.
  addSpanAttributes({
    'message.id': message.id,
    'message.type': message.type,
    'message.subject': subject,
    'message.body.length': body.length,
    // Full body only in verbose mode (DD3 — privacy-safe default).
    ...(isVerboseEnabled() ? { 'message.body': body } : {}),
  });
  return jsonResult({ message });
}

export function inboxAck(
  context: McpServerContext,
  input: Record<string, unknown>,
): McpToolResult<InboxAckOutput> {
  const msgId = requireNonEmptyString(input.msgId, 'msgId');
  const peerMessages = readLane(context, 'outside');
  if (!peerMessages.some((message) => message.id === msgId)) {
    throw new McpToolError('MCP_NOT_FOUND', 'message was not found');
  }

  const ownMessages = readLane(context, 'inside');
  const existing = ownMessages.find(
    (message) => message.type === 'ack' && message.ackOf === msgId,
  );
  if (existing) {
    return jsonResult({
      acked: true,
      alreadyAcked: true,
      msgId,
      ack: existing,
    });
  }

  const ack: InboxMessage = {
    id: ulid(),
    sender: 'inside',
    type: 'ack',
    subject: `Ack: ${msgId}`,
    body: `Acknowledged message ${msgId}`,
    ts: new Date().toISOString(),
    ackOf: msgId,
  };
  const ackTraceparent = getTraceparent();
  if (ackTraceparent !== undefined) ack.traceparent = ackTraceparent;
  appendMessage(lanePath(context, 'inside'), ack);
  coordinationMessagesSent.add(1, { type: 'ack', sender: 'inside' });
  return jsonResult({ acked: true, alreadyAcked: false, msgId, ack });
}

function readLane(context: McpServerContext, lane: Side): InboxMessage[] {
  const filePath = lanePath(context, lane);
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8');
  if (raw === '') return [];
  if (!raw.endsWith('\n')) {
    throw corruptInbox('inbox lane has a torn final line');
  }

  const messages: InboxMessage[] = [];
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    messages.push(parseMessageLine(lines[i], lane, i + 1));
  }
  return messages;
}

function parseMessageLine(
  line: string,
  lane: Side,
  lineNumber: number,
): InboxMessage {
  if (line.trim() === '')
    throw corruptInbox('inbox lane contains an empty line');
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw corruptInbox(
      `inbox lane contains malformed JSON at line ${lineNumber}`,
    );
  }
  if (!isRecord(value)) {
    throw corruptInbox(`inbox message at line ${lineNumber} must be an object`);
  }

  const message: InboxMessage = {
    id: requireStringField(value, 'id', lineNumber),
    sender: requireSender(value, lineNumber),
    type: requireStringField(value, 'type', lineNumber),
    subject: requireStringField(value, 'subject', lineNumber),
    body: requireStringField(value, 'body', lineNumber),
    ts: requireStringField(value, 'ts', lineNumber),
  };

  if (message.sender !== lane) {
    throw corruptInbox(
      `inbox message at line ${lineNumber} is in the wrong lane`,
    );
  }
  if (Number.isNaN(Date.parse(message.ts))) {
    throw corruptInbox(`inbox message at line ${lineNumber} has invalid ts`);
  }

  if (value.ackOf !== undefined) {
    if (typeof value.ackOf !== 'string' || value.ackOf === '') {
      throw corruptInbox(
        `inbox message at line ${lineNumber} has invalid ackOf`,
      );
    }
    message.ackOf = value.ackOf;
  }
  if (value.meta !== undefined) {
    message.meta = requireRecord(value.meta, 'meta');
  }
  if (value.traceparent !== undefined) {
    if (typeof value.traceparent !== 'string') {
      throw corruptInbox(
        `inbox message at line ${lineNumber} has invalid traceparent`,
      );
    }
    message.traceparent = value.traceparent;
  }
  if (value.tracestate !== undefined) {
    if (typeof value.tracestate !== 'string') {
      throw corruptInbox(
        `inbox message at line ${lineNumber} has invalid tracestate`,
      );
    }
    message.tracestate = value.tracestate;
  }
  return message;
}

function appendMessage(filePath: string, message: InboxMessage): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(message)}\n`);
}

function lanePath(context: McpServerContext, lane: Side): string {
  return inboxLanePath(coordinationRunLocationFromContext(context), lane);
}

function coordinationRunLocationFromContext(context: McpServerContext) {
  return coordinationRunLocation(
    context.agentSlug,
    context.agentsDir,
    context.runId,
  );
}

function parseInboxListInput(input: Record<string, unknown>): InboxListInput {
  const result: InboxListInput = {};
  if (input.unread !== undefined) {
    if (typeof input.unread !== 'boolean') {
      throw new McpToolError(
        'MCP_INVALID_ARGUMENT',
        'unread must be a boolean',
      );
    }
    result.unread = input.unread;
  }
  if (input.limit !== undefined) {
    if (typeof input.limit !== 'number') {
      throw new McpToolError('MCP_INVALID_ARGUMENT', 'limit must be a number');
    }
    result.limit = input.limit;
  }
  if (input.type !== undefined) {
    result.type = optionalNonEmptyString(input.type, 'type');
  }
  if (input.waitForAny !== undefined) {
    result.waitForAny = requireWaitForAny(input.waitForAny);
  }
  if (result.type !== undefined && result.waitForAny !== undefined) {
    throw new McpToolError(
      'MCP_INVALID_ARGUMENT',
      'type and waitForAny are mutually exclusive',
    );
  }
  if (input.after !== undefined) {
    result.after = requireNonEmptyString(input.after, 'after');
  }
  if (input.waitMs !== undefined) {
    if (typeof input.waitMs !== 'number') {
      throw new McpToolError('MCP_INVALID_ARGUMENT', 'waitMs must be a number');
    }
    result.waitMs = input.waitMs;
  }
  return result;
}

function requireWaitForAny(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new McpToolError(
      'MCP_INVALID_ARGUMENT',
      'waitForAny must be an array',
    );
  }
  if (value.length < 1 || value.length > 16) {
    throw new McpToolError(
      'MCP_INVALID_ARGUMENT',
      'waitForAny must contain 1 to 16 message types',
    );
  }

  const seen = new Set<string>();
  const types: string[] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item !== 'string' || item.trim() === '' || item.length > 64) {
      throw new McpToolError(
        'MCP_INVALID_ARGUMENT',
        `waitForAny[${index}] must be a non-empty string up to 64 characters`,
      );
    }
    if (seen.has(item)) {
      throw new McpToolError(
        'MCP_INVALID_ARGUMENT',
        'waitForAny must not contain duplicate message types',
      );
    }
    seen.add(item);
    types.push(item);
  }
  return types;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new McpToolError(
      'MCP_INVALID_ARGUMENT',
      `${field} must be a non-empty string`,
    );
  }
  return value;
}

function optionalNonEmptyString(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined) return undefined;
  return requireNonEmptyString(value, field);
}

function parseOptionalAckOf(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const ackOf = requireNonEmptyString(value, 'ackOf');
  if (ackOf.length > 128) {
    throw new McpToolError(
      'MCP_INVALID_ARGUMENT',
      'ackOf must be at most 128 characters',
    );
  }
  return ackOf;
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new McpToolError(
      'MCP_INVALID_ARGUMENT',
      `${field} must be an object`,
    );
  }
  return value;
}

function requireStringField(
  record: Record<string, unknown>,
  field: string,
  lineNumber: number,
): string {
  const value = record[field];
  if (typeof value !== 'string' || value === '') {
    throw corruptInbox(
      `inbox message at line ${lineNumber} has invalid ${field}`,
    );
  }
  return value;
}

function requireSender(
  record: Record<string, unknown>,
  lineNumber: number,
): InboxMessage['sender'] {
  const value = record.sender;
  if (value !== 'inside' && value !== 'outside') {
    throw corruptInbox(
      `inbox message at line ${lineNumber} has invalid sender`,
    );
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function corruptInbox(message: string): McpToolError {
  return new McpToolError('MCP_INBOX_CORRUPT', message);
}
