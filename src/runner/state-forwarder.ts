import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import type { SessionSender } from '../adapter/events.js';
import {
  type FileWatcher,
  type WatchFactory,
  type WatchFileChangesOptions,
  watchFileChanges,
} from './file-watcher.js';
import { stateFilePath } from './folder.js';
import {
  assertPathInsideAgentsDir,
  readForwarderWatermark,
  updateForwarderWatermark,
  withStateFingerprint,
} from './forwarder-watermark.js';
import { readStateLazy } from './state.js';
import type { OutsideState } from './types.js';

export interface StateForwarderOptions {
  slug: string;
  agentsDir: string;
  sender: SessionSender;
  commitProgress?: 'immediate' | 'manual';
  debounceMs?: number;
  onError?: (error: Error) => void;
  watchFactory?: WatchFactory;
}

export interface StateDrainResult {
  sent: boolean;
  fingerprint: string | null;
}

export interface StateForwarder {
  start(): Promise<StateDrainResult>;
  drain(): Promise<StateDrainResult>;
  pendingCount(): number;
  commit(): void;
  close(): void;
}

export function createStateForwarder(
  options: StateForwarderOptions,
): StateForwarder {
  let pendingDrains = 0;
  let closed = false;
  let currentFingerprint: string | null | undefined;
  let currentFingerprintLoaded = false;
  let hasUncommittedProgress = false;
  let queue = Promise.resolve();
  let watcher: FileWatcher | null = null;
  let starting: Promise<StateDrainResult> | undefined;

  const readCurrentFingerprint = (): string | null => {
    if (!currentFingerprintLoaded) {
      currentFingerprint =
        readForwarderWatermark(options).value.state.outsideFingerprint;
      currentFingerprintLoaded = true;
    }
    return currentFingerprint ?? null;
  };

  const drain = async (): Promise<StateDrainResult> => {
    if (closed) return { sent: false, fingerprint: readCurrentFingerprint() };
    pendingDrains++;
    const run = queue.then(() =>
      drainOnce(options, readCurrentFingerprint(), (fingerprint) => {
        currentFingerprint = fingerprint;
        currentFingerprintLoaded = true;
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

  const start = async (): Promise<StateDrainResult> => {
    if (closed) return { sent: false, fingerprint: readCurrentFingerprint() };
    if (watcher) return { sent: false, fingerprint: readCurrentFingerprint() };
    if (starting) return starting;

    const run = (async () => {
      const coldDrain = await drain();
      if (closed) return coldDrain;

      const outsideStatePath = stateFilePath(
        options.slug,
        options.agentsDir,
        'outside',
      );
      assertPathInsideAgentsDir(outsideStatePath, options.agentsDir);
      watcher = watchFileChanges(
        outsideStatePath,
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
      const fingerprint = readCurrentFingerprint();
      updateForwarderWatermark(options, (current) =>
        withStateFingerprint(current, fingerprint),
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

export function renderStateChangeForAgent(state: OutsideState): string {
  return [
    '## Outside state changed',
    '',
    `Status: ${state.status}`,
    `Updated At: ${state.updatedAt}`,
    '',
    'Data:',
    stableStringify(state.data),
  ].join('\n');
}

export function fingerprintOutsideState(state: OutsideState): string {
  const meaningfulState = {
    status: state.status,
    data: state.data,
  };
  return crypto
    .createHash('sha256')
    .update(stableStringify(meaningfulState))
    .digest('hex');
}

async function drainOnce(
  options: StateForwarderOptions,
  lastSentFingerprint: string | null,
  onProgress: (fingerprint: string) => void,
): Promise<StateDrainResult> {
  const outsideStatePath = stateFilePath(
    options.slug,
    options.agentsDir,
    'outside',
  );
  assertPathInsideAgentsDir(outsideStatePath, options.agentsDir);
  if (!fs.existsSync(outsideStatePath)) {
    return { sent: false, fingerprint: lastSentFingerprint };
  }

  const state = readStateLazy(
    'outside',
    options.slug,
    options.agentsDir,
  ) as OutsideState;
  const nextFingerprint = fingerprintOutsideState(state);
  if (lastSentFingerprint === nextFingerprint) {
    return { sent: false, fingerprint: nextFingerprint };
  }

  await options.sender.send(renderStateChangeForAgent(state));
  if (options.commitProgress !== 'manual') {
    updateForwarderWatermark(options, (current) =>
      withStateFingerprint(current, nextFingerprint),
    );
  }
  onProgress(nextFingerprint);
  return { sent: true, fingerprint: nextFingerprint };
}

function watchOptions(
  options: StateForwarderOptions,
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

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}
