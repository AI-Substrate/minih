import * as fs from 'node:fs';
import * as path from 'node:path';

export type WatchEventType = 'rename' | 'change';

export interface FileChangeEvent {
  targetPath: string;
  eventType: WatchEventType;
  filename: string | null;
  exists: boolean;
}

export interface FileWatcher {
  readonly closed: boolean;
  pendingCount(): number;
  close(): void;
  flush(): void;
}

export interface NativeWatcher {
  close(): void;
  on(event: 'error', listener: (error: Error) => void): NativeWatcher;
}

export type WatchFactory = (
  filename: string,
  listener: (
    eventType: WatchEventType,
    filename: string | Buffer | null,
  ) => void,
) => NativeWatcher;

export interface WatchFileChangesOptions {
  debounceMs?: number;
  ensureParent?: boolean;
  onError?: (error: Error) => void;
  watchFactory?: WatchFactory;
}

const DEFAULT_DEBOUNCE_MS = 50;

/**
 * Watch a single file by subscribing to its parent directory.
 *
 * Watching the parent lets forwarders observe first-write creation when the
 * inbox/state file does not exist yet. Native `fs.watch` events are treated as
 * hints only; callers must re-read durable state after each debounced callback.
 */
export function watchFileChanges(
  targetPath: string,
  onChange: (event: FileChangeEvent) => void,
  options: WatchFileChangesOptions = {},
): FileWatcher {
  const absoluteTarget = path.resolve(targetPath);
  const parentDir = path.dirname(absoluteTarget);
  const targetBasename = path.basename(absoluteTarget);
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const ensureParent = options.ensureParent ?? true;
  const watchFactory = options.watchFactory ?? fs.watch;

  if (ensureParent) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Pick<FileChangeEvent, 'eventType' | 'filename'> | undefined;

  const clearPendingTimer = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const emitPending = (): void => {
    if (closed || !pending) return;
    const current = pending;
    pending = undefined;
    timer = undefined;
    onChange({
      targetPath: absoluteTarget,
      eventType: current.eventType,
      filename: current.filename,
      exists: fs.existsSync(absoluteTarget),
    });
  };

  const schedule = (
    eventType: WatchEventType,
    filename: string | Buffer | null,
  ): void => {
    if (closed) return;
    const normalizedFilename = filename === null ? null : String(filename);
    if (normalizedFilename !== null && normalizedFilename !== targetBasename) {
      return;
    }

    pending = {
      eventType,
      filename: normalizedFilename,
    };
    clearPendingTimer();
    timer = setTimeout(emitPending, debounceMs);
  };

  let nativeWatcher: NativeWatcher;
  try {
    nativeWatcher = watchFactory(parentDir, schedule);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    options.onError?.(err);
    throw err;
  }

  nativeWatcher.on('error', (error) => {
    if (closed) return;
    options.onError?.(error);
  });

  return {
    get closed() {
      return closed;
    },
    pendingCount() {
      return pending ? 1 : 0;
    },
    close() {
      if (closed) return;
      closed = true;
      pending = undefined;
      clearPendingTimer();
      nativeWatcher.close();
    },
    flush() {
      clearPendingTimer();
      emitPending();
    },
  };
}
