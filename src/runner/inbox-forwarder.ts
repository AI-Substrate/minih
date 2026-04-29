import * as fs from 'node:fs';
import type { SessionSender } from '../adapter/events.js';
import {
  type FileWatcher,
  type WatchFactory,
  type WatchFileChangesOptions,
  watchFileChanges,
} from './file-watcher.js';
import { inboxLanePath } from './folder.js';
import {
  assertPathInsideAgentsDir,
  readForwarderWatermark,
  updateForwarderWatermark,
  withInboxOffset,
} from './forwarder-watermark.js';
import type { InboxMessage } from './types.js';

export interface InboxForwarderOptions {
  slug: string;
  agentsDir: string;
  runId: string;
  sender: SessionSender;
  commitProgress?: 'immediate' | 'manual';
  debounceMs?: number;
  onError?: (error: Error) => void;
  watchFactory?: WatchFactory;
}

export interface InboxDrainResult {
  startOffset: number;
  endOffset: number;
  sent: number;
  stoppedOnTornLine: boolean;
}

export class InvalidInboxMessageError extends Error {
  constructor(
    readonly offset: number,
    message: string,
  ) {
    super(`invalid outside inbox message at byte ${offset}: ${message}`);
    this.name = 'InvalidInboxMessageError';
  }
}

export interface InboxForwarder {
  start(): Promise<InboxDrainResult>;
  drain(): Promise<InboxDrainResult>;
  pendingCount(): number;
  commit(): void;
  close(): void;
}

export function createInboxForwarder(
  options: InboxForwarderOptions,
): InboxForwarder {
  let pendingDrains = 0;
  let closed = false;
  let currentOffset: number | undefined;
  let hasUncommittedProgress = false;
  let queue = Promise.resolve();
  let watcher: FileWatcher | null = null;
  let starting: Promise<InboxDrainResult> | undefined;

  const readCurrentOffset = (): number => {
    currentOffset ??= readForwarderWatermark(options).value.inbox.outsideOffset;
    return currentOffset;
  };

  const drain = async (): Promise<InboxDrainResult> => {
    if (closed) return emptyResult(readCurrentOffset());
    pendingDrains++;
    const run = queue.then(() =>
      drainOnce(options, readCurrentOffset(), (offset) => {
        currentOffset = offset;
        hasUncommittedProgress = true;
      }),
    );
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    try {
      return await run;
    } finally {
      pendingDrains--;
    }
  };

  const handleError = (error: Error): void => {
    if (options.onError) {
      options.onError(error);
      return;
    }
    queueMicrotask(() => {
      throw error;
    });
  };

  const start = async (): Promise<InboxDrainResult> => {
    if (closed) return emptyResult(readCurrentOffset());
    if (watcher) return emptyResult(readCurrentOffset());
    if (starting) return starting;

    const run = (async () => {
      const coldDrain = await drain();
      if (closed) return coldDrain;

      const inboxPath = inboxLanePath(options, 'outside');
      assertPathInsideAgentsDir(inboxPath, options.agentsDir);
      watcher = watchFileChanges(
        inboxPath,
        () => {
          void drain().catch((error: unknown) => handleError(toError(error)));
        },
        watchOptions(options, handleError),
      );

      await drain();
      return coldDrain;
    })();

    starting = run.finally(() => {
      starting = undefined;
    });
    return starting;
  };

  return {
    start,
    drain,
    pendingCount() {
      return pendingDrains + (watcher?.pendingCount() ?? 0);
    },
    commit() {
      if (!hasUncommittedProgress) return;
      const offset = readCurrentOffset();
      updateForwarderWatermark(options, (current) =>
        withInboxOffset(current, offset),
      );
      hasUncommittedProgress = false;
    },
    close() {
      closed = true;
      watcher?.close();
      watcher = null;
    },
  };
}

export function renderInboxMessageForAgent(message: InboxMessage): string {
  const lines = [
    '## Outside inbox message',
    '',
    `ID: ${message.id}`,
    `Type: ${message.type}`,
    `Subject: ${message.subject}`,
    `Timestamp: ${message.ts}`,
  ];
  if (message.ackOf) {
    // Plan 013: 'ackOf' is now a general parent pointer for reply chains.
    // 'Acknowledges:' is preserved for type=ack (today's contract); any
    // other type with ackOf renders as a plain reply.
    const label = message.type === 'ack' ? 'Acknowledges' : 'In reply to';
    lines.push(`${label}: ${message.ackOf}`);
  }
  lines.push('', message.body);
  return lines.join('\n');
}

async function drainOnce(
  options: InboxForwarderOptions,
  startOffset: number,
  onProgress: (offset: number) => void,
): Promise<InboxDrainResult> {
  const inboxPath = inboxLanePath(options, 'outside');
  assertPathInsideAgentsDir(inboxPath, options.agentsDir);

  if (!fs.existsSync(inboxPath)) return emptyResult(startOffset);

  const content = fs.readFileSync(inboxPath);
  if (startOffset >= content.length) return emptyResult(startOffset);

  let cursor = startOffset;
  let sent = 0;

  for (const line of completeLinesFrom(content, startOffset)) {
    const message = parseInboxMessage(line.text, line.startOffset);
    await options.sender.send(renderInboxMessageForAgent(message));
    if (options.commitProgress !== 'manual') {
      updateForwarderWatermark(options, (current) =>
        withInboxOffset(current, line.endOffset),
      );
    }
    cursor = line.endOffset;
    onProgress(cursor);
    sent++;
  }

  return {
    startOffset,
    endOffset: cursor,
    sent,
    stoppedOnTornLine: cursor < content.length,
  };
}

function watchOptions(
  options: InboxForwarderOptions,
  onError: (error: Error) => void,
): WatchFileChangesOptions {
  const result: WatchFileChangesOptions = { onError };
  if (options.debounceMs !== undefined) result.debounceMs = options.debounceMs;
  if (options.watchFactory !== undefined) {
    result.watchFactory = options.watchFactory;
  }
  return result;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function emptyResult(offset: number): InboxDrainResult {
  return {
    startOffset: offset,
    endOffset: offset,
    sent: 0,
    stoppedOnTornLine: false,
  };
}

function completeLinesFrom(content: Buffer, offset: number) {
  const lines: Array<{
    text: string;
    startOffset: number;
    endOffset: number;
  }> = [];
  let lineStart = offset;
  for (let i = offset; i < content.length; i++) {
    if (content[i] !== 10) continue;
    const raw = content.subarray(lineStart, i);
    const text =
      raw.at(-1) === 13
        ? raw.subarray(0, -1).toString('utf8')
        : raw.toString('utf8');
    lines.push({
      text,
      startOffset: lineStart,
      endOffset: i + 1,
    });
    lineStart = i + 1;
  }
  return lines;
}

function parseInboxMessage(text: string, offset: number): InboxMessage {
  if (!text.trim()) {
    throw new InvalidInboxMessageError(offset, 'line is empty');
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new InvalidInboxMessageError(offset, message);
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InvalidInboxMessageError(offset, 'message must be an object');
  }

  const record = value as Record<string, unknown>;
  const message: InboxMessage = {
    id: requireString(record, 'id', offset),
    sender: requireSide(record, offset),
    type: requireString(record, 'type', offset),
    subject: requireString(record, 'subject', offset),
    body: requireString(record, 'body', offset),
    ts: requireString(record, 'ts', offset),
  };

  if (message.sender !== 'outside') {
    throw new InvalidInboxMessageError(
      offset,
      'outside inbox messages must have sender "outside"',
    );
  }

  const ackOf = record.ackOf;
  if (ackOf !== undefined) {
    if (typeof ackOf !== 'string') {
      throw new InvalidInboxMessageError(offset, 'ackOf must be a string');
    }
    message.ackOf = ackOf;
  }

  const meta = record.meta;
  if (meta !== undefined) {
    if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) {
      throw new InvalidInboxMessageError(offset, 'meta must be an object');
    }
    message.meta = meta as Record<string, unknown>;
  }

  return message;
}

function requireString(
  record: Record<string, unknown>,
  key: string,
  offset: number,
): string {
  const value = record[key];
  if (typeof value !== 'string') {
    throw new InvalidInboxMessageError(offset, `${key} must be a string`);
  }
  return value;
}

function requireSide(
  record: Record<string, unknown>,
  offset: number,
): InboxMessage['sender'] {
  const value = record.sender;
  if (value !== 'outside' && value !== 'inside') {
    throw new InvalidInboxMessageError(
      offset,
      'sender must be "outside" or "inside"',
    );
  }
  return value;
}
