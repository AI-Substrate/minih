import * as fs from 'node:fs';
import * as path from 'node:path';
import { coordinationRunLocation, inboxLanePath } from '../../runner/folder.js';
import type { InboxMessage, Side } from '../../runner/types.js';
import { ulid } from '../../runner/ulid.js';
import type { McpServerContext } from '../context.js';
import {
  type InboxListInput,
  jsonResult,
  McpToolError,
  type McpToolResult,
} from '../types.js';

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

export interface InboxListOutput {
  messages: InboxMessage[];
  nextAfter: string | null;
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

export function inboxList(
  context: McpServerContext,
  input: Record<string, unknown> = {},
): McpToolResult<InboxListOutput> {
  const listInput = parseInboxListInput(input);
  const limit = normalizeLimit(listInput.limit);
  const peerMessages = readLane(context, 'outside');
  const ownMessages = readLane(context, 'inside');
  const acknowledged = new Set(
    ownMessages
      .filter((message) => message.type === 'ack' && message.ackOf)
      .map((message) => message.ackOf as string),
  );

  let visible = listInput.unread
    ? peerMessages.filter((message) => !acknowledged.has(message.id))
    : peerMessages;

  if (listInput.type !== undefined) {
    visible = visible.filter((message) => message.type === listInput.type);
  }

  if (listInput.after !== undefined) {
    const index = visible.findIndex(
      (message) => message.id === listInput.after,
    );
    visible = index === -1 ? [] : visible.slice(index + 1);
  }

  const messages = visible.slice(0, limit);
  return jsonResult({
    messages,
    nextAfter: visible.length > limit ? (messages.at(-1)?.id ?? null) : null,
  });
}

export function inboxSend(
  context: McpServerContext,
  input: Record<string, unknown>,
): McpToolResult<InboxSendOutput> {
  const subject = requireNonEmptyString(input.subject, 'subject');
  const body = requireNonEmptyString(input.body, 'body');
  const type = optionalNonEmptyString(input.type, 'type') ?? 'note';
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

  appendMessage(lanePath(context, 'inside'), message);
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
  appendMessage(lanePath(context, 'inside'), ack);
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

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIST_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
    throw new McpToolError(
      'MCP_INVALID_ARGUMENT',
      `limit must be an integer from 1 to ${MAX_LIST_LIMIT}`,
    );
  }
  return limit;
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
  if (input.after !== undefined) {
    result.after = requireNonEmptyString(input.after, 'after');
  }
  return result;
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
