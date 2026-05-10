import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionSender } from '../../src/adapter/events.js';
import type {
  NativeWatcher,
  WatchEventType,
} from '../../src/runner/file-watcher.js';
import {
  coordinationRunLocation,
  stateFilePath,
} from '../../src/runner/folder.js';
import {
  defaultForwarderWatermark,
  readForwarderWatermark,
  withStateFingerprint,
  writeForwarderWatermark,
} from '../../src/runner/forwarder-watermark.js';
import { StateCorruptError, writeState } from '../../src/runner/state.js';
import {
  createStateForwarder,
  fingerprintOutsideState,
} from '../../src/runner/state-forwarder.js';
import type { OutsideState } from '../../src/runner/types.js';

let tmpDir: string;
let agentsDir: string;
const slug = 'code-review';
const runId = 'run-123';

class FakeNativeWatcher implements NativeWatcher {
  closeCalls = 0;
  private errorListener: ((error: Error) => void) | undefined;

  constructor(
    private readonly listener: (
      eventType: WatchEventType,
      filename: string | Buffer | null,
    ) => void,
  ) {}

  on(event: 'error', listener: (error: Error) => void): NativeWatcher {
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

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-state-forwarder-'));
  agentsDir = path.join(tmpDir, 'agents');
  fs.mkdirSync(agentsDir);
});

afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function sender(responses: Array<'ok' | Error> = []): SessionSender & {
  prompts: string[];
} {
  const prompts: string[] = [];
  return {
    prompts,
    async send(prompt: string) {
      prompts.push(prompt);
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response ?? 'ok';
    },
  };
}

function state(overrides: Partial<OutsideState> = {}): OutsideState {
  return {
    status: 'in-progress',
    data: { milestone: 2 },
    updatedAt: '2026-04-26T00:00:00Z',
    updatedBy: 'outside',
    ...overrides,
  };
}

function writeOutsideState(value: OutsideState): void {
  writeState(coordinationRunLocation(slug, agentsDir, runId), 'outside', value);
}

function forwarder(testSender = sender()) {
  return createStateForwarder({
    slug,
    agentsDir,
    runId,
    sender: testSender,
  });
}

describe('state forwarder', () => {
  it('does nothing when outside state is absent', async () => {
    const testSender = sender();

    const result = await forwarder(testSender).drain();

    expect(result).toEqual({ sent: false, fingerprint: null });
    expect(testSender.prompts).toEqual([]);
    expect(readForwarderWatermark({ slug, agentsDir, runId }).value).toEqual(
      defaultForwarderWatermark(),
    );
  });

  it('forwards the first seen outside state and persists its fingerprint', async () => {
    const current = state();
    writeOutsideState(current);
    const testSender = sender();

    const result = await forwarder(testSender).drain();

    expect(result).toEqual({
      sent: true,
      fingerprint: fingerprintOutsideState(current),
    });
    expect(testSender.prompts).toHaveLength(1);
    expect(testSender.prompts[0]).toContain('Status: in-progress');
    expect(testSender.prompts[0]).toContain('"milestone":2');
    expect(
      readForwarderWatermark({ slug, agentsDir, runId }).value.state
        .outsideFingerprint,
    ).toBe(fingerprintOutsideState(current));
  });

  it('does not re-forward unchanged meaningful state', async () => {
    const current = state();
    writeOutsideState(current);
    writeForwarderWatermark(
      { slug, agentsDir, runId },
      withStateFingerprint(
        defaultForwarderWatermark(),
        fingerprintOutsideState(current),
      ),
    );
    const testSender = sender();

    const result = await forwarder(testSender).drain();

    expect(result.sent).toBe(false);
    expect(testSender.prompts).toEqual([]);
  });

  it('ignores updatedAt-only changes when status and data are unchanged', async () => {
    const current = state();
    const touched = state({ updatedAt: '2026-04-26T00:01:00Z' });
    writeOutsideState(touched);
    writeForwarderWatermark(
      { slug, agentsDir, runId },
      withStateFingerprint(
        defaultForwarderWatermark(),
        fingerprintOutsideState(current),
      ),
    );
    const testSender = sender();

    const result = await forwarder(testSender).drain();

    expect(result.sent).toBe(false);
    expect(testSender.prompts).toEqual([]);
  });

  it('forwards changed status or data', async () => {
    const previous = state();
    const next = state({ status: 'done', data: { milestone: 3 } });
    writeOutsideState(next);
    writeForwarderWatermark(
      { slug, agentsDir, runId },
      withStateFingerprint(
        defaultForwarderWatermark(),
        fingerprintOutsideState(previous),
      ),
    );
    const testSender = sender();

    const result = await forwarder(testSender).drain();

    expect(result.sent).toBe(true);
    expect(testSender.prompts[0]).toContain('Status: done');
    expect(
      readForwarderWatermark({ slug, agentsDir, runId }).value.state
        .outsideFingerprint,
    ).toBe(fingerprintOutsideState(next));
  });

  it('does not persist the fingerprint when sending fails', async () => {
    const current = state();
    writeOutsideState(current);
    const testSender = sender([new Error('state send failed')]);

    await expect(forwarder(testSender).drain()).rejects.toThrow(
      'state send failed',
    );

    expect(
      readForwarderWatermark({ slug, agentsDir, runId }).value.state
        .outsideFingerprint,
    ).toBeNull();
  });

  it('surfaces corrupt outside state and leaves progress unchanged', async () => {
    const target = stateFilePath(
      coordinationRunLocation(slug, agentsDir, runId),
      'outside',
    );
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '{bad-json');

    await expect(forwarder(sender()).drain()).rejects.toThrow(
      StateCorruptError,
    );
    expect(
      readForwarderWatermark({ slug, agentsDir, runId }).value.state
        .outsideFingerprint,
    ).toBeNull();
  });

  it('rejects state path symlink escapes before reading', async () => {
    const escaped = path.join(tmpDir, 'escaped');
    fs.mkdirSync(escaped);
    const stateDir = path.dirname(
      stateFilePath(coordinationRunLocation(slug, agentsDir, runId), 'outside'),
    );
    fs.mkdirSync(path.dirname(stateDir), { recursive: true });
    fs.symlinkSync(escaped, stateDir);

    await expect(forwarder(sender()).drain()).rejects.toThrow(
      /outside agentsDir/,
    );
  });

  it('tracks pending drains while a send is in flight', async () => {
    writeOutsideState(state());
    let release: (() => void) | undefined;
    const testSender: SessionSender = {
      send: vi.fn(
        () =>
          new Promise<string>((resolve) => {
            release = () => resolve('ok');
          }),
      ),
    };
    const stateForwarder = forwarder(testSender);

    const promise = stateForwarder.drain();
    await vi.waitFor(() => expect(stateForwarder.pendingCount()).toBe(1));
    release?.();
    await promise;

    expect(stateForwarder.pendingCount()).toBe(0);
  });

  it('drains cold-start state before subscribing, then reacts to live watcher events', async () => {
    vi.useFakeTimers();
    const order: string[] = [];
    let fake: FakeNativeWatcher | undefined;
    writeOutsideState(state());
    const testSender: SessionSender & { prompts: string[] } = {
      prompts: [],
      async send(prompt: string) {
        order.push('send');
        this.prompts.push(prompt);
        return 'ok';
      },
    };
    const stateForwarder = createStateForwarder({
      slug,
      agentsDir,
      runId,
      sender: testSender,
      debounceMs: 1,
      watchFactory: (_filename, listener) => {
        order.push('watch');
        fake = new FakeNativeWatcher(listener);
        return fake;
      },
    });

    await stateForwarder.start();

    expect(order).toEqual(['send', 'watch']);
    expect(testSender.prompts).toHaveLength(1);
    writeOutsideState(state({ data: { milestone: 3 } }));
    fake?.emit('change', 'outside.json');
    vi.advanceTimersByTime(1);

    await vi.waitFor(() => expect(testSender.prompts).toHaveLength(2));
    expect(testSender.prompts[1]).toContain('"milestone":3');
  });
});
