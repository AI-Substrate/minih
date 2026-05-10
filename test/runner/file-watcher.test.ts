import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type FileChangeEvent,
  type WatchEventType,
  watchFileChanges,
} from '../../src/runner/file-watcher.js';

class FakeNativeWatcher {
  closeCalls = 0;
  private errorListener: ((error: Error) => void) | undefined;

  constructor(
    private readonly listener: (
      eventType: WatchEventType,
      filename: string | Buffer | null,
    ) => void,
  ) {}

  on(event: 'error', listener: (error: Error) => void): FakeNativeWatcher {
    if (event === 'error') this.errorListener = listener;
    return this;
  }

  close(): void {
    this.closeCalls++;
  }

  emit(eventType: WatchEventType, filename: string | Buffer | null): void {
    this.listener(eventType, filename);
  }

  emitError(error: Error): void {
    this.errorListener?.(error);
  }
}

let tmpDir: string;

beforeEach(() => {
  vi.useFakeTimers();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-file-watch-'));
});

afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function createHarness(targetPath: string) {
  let watchedPath = '';
  let fake: FakeNativeWatcher | undefined;
  const events: FileChangeEvent[] = [];
  const errors: Error[] = [];

  const watcher = watchFileChanges(targetPath, (event) => events.push(event), {
    debounceMs: 50,
    onError: (error) => errors.push(error),
    watchFactory: (filename, listener) => {
      watchedPath = filename;
      fake = new FakeNativeWatcher(listener);
      return fake;
    },
  });

  if (!fake) throw new Error('expected fake watcher to be created');
  return { watcher, fake, events, errors, watchedPath };
}

describe('watchFileChanges', () => {
  it('watches the parent directory so missing target files can be created later', () => {
    const targetPath = path.join(tmpDir, 'agent', 'inbox', 'messages.ndjson');
    const { fake, events, watchedPath } = createHarness(targetPath);

    expect(fs.existsSync(path.dirname(targetPath))).toBe(true);
    expect(watchedPath).toBe(path.dirname(targetPath));

    fake.emit('change', 'messages.ndjson');
    vi.advanceTimersByTime(50);

    expect(events).toEqual([
      {
        targetPath,
        eventType: 'change',
        filename: 'messages.ndjson',
        exists: false,
      },
    ]);
  });

  it('filters unrelated filenames but treats null filenames as conservative hints', () => {
    const targetPath = path.join(tmpDir, 'state', 'outside.json');
    const { fake, events } = createHarness(targetPath);

    fake.emit('change', 'inside.json');
    vi.advanceTimersByTime(50);
    expect(events).toHaveLength(0);

    fake.emit('rename', null);
    vi.advanceTimersByTime(50);
    expect(events).toMatchObject([
      {
        eventType: 'rename',
        filename: null,
        exists: false,
      },
    ]);
  });

  it('debounces burst events and emits only the latest file state', () => {
    const targetPath = path.join(tmpDir, 'state', 'outside.json');
    const { fake, events } = createHarness(targetPath);

    fake.emit('change', 'outside.json');
    vi.advanceTimersByTime(25);
    fake.emit('rename', 'outside.json');
    vi.advanceTimersByTime(25);
    fake.emit('change', 'outside.json');
    fs.writeFileSync(targetPath, '{}');

    vi.advanceTimersByTime(49);
    expect(events).toHaveLength(0);

    vi.advanceTimersByTime(1);
    expect(events).toEqual([
      {
        targetPath,
        eventType: 'change',
        filename: 'outside.json',
        exists: true,
      },
    ]);
  });

  it('counts a debounced pending event before the callback fires', () => {
    const targetPath = path.join(tmpDir, 'state', 'outside.json');
    const { fake, watcher, events } = createHarness(targetPath);

    fake.emit('change', 'outside.json');

    expect(watcher.pendingCount()).toBe(1);
    expect(events).toHaveLength(0);

    vi.advanceTimersByTime(50);
    expect(watcher.pendingCount()).toBe(0);
    expect(events).toHaveLength(1);
  });

  it('flushes a pending event immediately', () => {
    const targetPath = path.join(tmpDir, 'state', 'outside.json');
    const { fake, watcher, events } = createHarness(targetPath);

    fake.emit('rename', 'outside.json');
    watcher.flush();

    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe('rename');
  });

  it('closes idempotently and suppresses pending callbacks after close', () => {
    const targetPath = path.join(tmpDir, 'state', 'outside.json');
    const { fake, watcher, events } = createHarness(targetPath);

    fake.emit('change', 'outside.json');
    watcher.close();
    watcher.close();
    vi.advanceTimersByTime(50);

    expect(events).toHaveLength(0);
    expect(fake.closeCalls).toBe(1);
    expect(watcher.closed).toBe(true);
  });

  it('surfaces watcher errors until close and ignores post-close errors', () => {
    const targetPath = path.join(tmpDir, 'state', 'outside.json');
    const { fake, watcher, errors } = createHarness(targetPath);
    const first = new Error('watch failed');
    const second = new Error('late watch failure');

    fake.emitError(first);
    watcher.close();
    fake.emitError(second);

    expect(errors).toEqual([first]);
  });

  it('surfaces startup failures through onError and throws', () => {
    const targetPath = path.join(tmpDir, 'state', 'outside.json');
    const errors: Error[] = [];
    const startupError = new Error('ENOENT');

    expect(() =>
      watchFileChanges(targetPath, () => {}, {
        onError: (error) => errors.push(error),
        watchFactory: () => {
          throw startupError;
        },
      }),
    ).toThrow(startupError);
    expect(errors).toEqual([startupError]);
  });
});
