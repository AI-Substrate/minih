import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type AgentEvent,
  type AgentResult,
  type AgentRunOptions,
  FakeAgentAdapter,
  type IAgentAdapter,
} from '../../src/adapter/index.js';
import {
  coordinationRunLocation,
  inboxLanePath,
  resolveAgent,
} from '../../src/runner/folder.js';
import { readForwarderWatermark } from '../../src/runner/forwarder-watermark.js';
import { awaitTerminalCondition, runAgent } from '../../src/runner/runner.js';
import { writeState } from '../../src/runner/state.js';
import type { OutsideState } from '../../src/runner/types.js';
import { validSystemOutput } from '../helpers/fixtures.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-runner-events-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function createAgent(slug: string, options: { coordination?: boolean } = {}) {
  const agentDir = path.join(tmpDir, slug);
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, 'prompt.md'),
    `---\ndescription: "Event-driven test agent"\n${options.coordination ? 'coordination: enabled\n' : ''}---\n\n# ${slug}\n\nDo the thing.`,
  );

  const definition = resolveAgent(slug, tmpDir);
  if (!definition) {
    throw new Error(`expected agent ${slug} to resolve`);
  }
  return definition;
}

function writeOutsideInbox(
  slug: string,
  runDir: string,
  subject: string,
): void {
  const target = inboxLanePath(locationForRun(slug, runDir), 'outside');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    target,
    `${JSON.stringify({
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      sender: 'outside',
      type: 'note',
      subject,
      body: 'Please review this update.',
      ts: '2026-04-26T00:00:00Z',
    })}\n`,
  );
}

function writeOutsideState(slug: string, runDir: string): void {
  const state: OutsideState = {
    status: 'in-progress',
    data: { milestone: 2 },
    updatedAt: '2026-04-26T00:00:00Z',
    updatedBy: 'outside',
  };
  writeState(locationForRun(slug, runDir), 'outside', state);
}

function locationForRun(slug: string, runDir: string) {
  return coordinationRunLocation(slug, tmpDir, path.basename(runDir));
}

class SeededFakeAgentAdapter extends FakeAgentAdapter {
  constructor(
    options: ConstructorParameters<typeof FakeAgentAdapter>[0],
    private readonly seed: (runDir: string) => void,
  ) {
    super(options);
  }

  override async run(options: AgentRunOptions): Promise<AgentResult> {
    if (!options.cwd) throw new Error('expected run cwd');
    this.seed(options.cwd);
    return super.run(options);
  }
}

function completedResult(): AgentResult {
  return {
    output: validSystemOutput(),
    sessionId: 'session-1',
    status: 'completed',
    exitCode: 0,
    tokens: null,
  };
}

class PendingSendAdapter implements IAgentAdapter {
  prompts: string[] = [];
  terminateHistory: string[] = [];
  private releaseSend: (() => void) | undefined;

  constructor(
    private readonly releaseAutomatically = false,
    private readonly seed?: (runDir: string) => void,
  ) {}

  async run(options: AgentRunOptions): Promise<AgentResult> {
    if (this.seed) {
      if (!options.cwd) throw new Error('expected run cwd');
      this.seed(options.cwd);
    }
    options.onEvent?.({
      type: 'session_start',
      timestamp: '2026-01-01T00:00:00Z',
      data: { sessionId: 'pending-session' },
    });
    options.onSessionReady?.({
      send: async (prompt: string): Promise<string> => {
        this.prompts.push(prompt);
        if (this.releaseAutomatically) return 'ok';
        return new Promise<string>((resolve) => {
          this.releaseSend = () => resolve('ok');
        });
      },
    });
    options.onEvent?.({
      type: 'session_idle',
      timestamp: '2026-01-01T00:00:01Z',
      data: { sessionId: 'pending-session' },
    });
    return completedResult();
  }

  async compact(sessionId: string): Promise<AgentResult> {
    return {
      output: '',
      sessionId,
      status: 'completed',
      exitCode: 0,
      tokens: null,
    };
  }

  async terminate(sessionId: string): Promise<AgentResult> {
    this.terminateHistory.push(sessionId);
    return {
      output: '',
      sessionId,
      status: 'killed',
      exitCode: 143,
      tokens: null,
    };
  }

  release(): void {
    this.releaseSend?.();
  }
}

class TimeoutAfterSendAdapter implements IAgentAdapter {
  prompts: string[] = [];
  terminateHistory: string[] = [];

  constructor(private readonly seed?: (runDir: string) => void) {}

  async run(options: AgentRunOptions): Promise<AgentResult> {
    if (this.seed) {
      if (!options.cwd) throw new Error('expected run cwd');
      this.seed(options.cwd);
    }
    options.onEvent?.({
      type: 'session_start',
      timestamp: '2026-01-01T00:00:00Z',
      data: { sessionId: 'timeout-after-send-session' },
    });
    options.onSessionReady?.({
      send: async (prompt: string): Promise<string> => {
        this.prompts.push(prompt);
        return 'queued';
      },
    });
    await new Promise(() => {});
    return completedResult();
  }

  async compact(sessionId: string): Promise<AgentResult> {
    return {
      output: '',
      sessionId,
      status: 'completed',
      exitCode: 0,
      tokens: null,
    };
  }

  async terminate(sessionId: string): Promise<AgentResult> {
    this.terminateHistory.push(sessionId);
    return {
      output: '',
      sessionId,
      status: 'killed',
      exitCode: 143,
      tokens: null,
    };
  }
}

describe('awaitTerminalCondition', () => {
  it('resolves immediately when the pending forwarder getter returns zero', async () => {
    const result = completedResult();

    await expect(awaitTerminalCondition(result, () => 0)).resolves.toBe(result);
  });

  it('uses a live pending forwarder getter until the count clears', async () => {
    const result = completedResult();
    let pendingForwarders = 1;
    let settled = false;

    const terminal = awaitTerminalCondition(result, () => pendingForwarders);
    terminal.then(() => {
      settled = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(settled).toBe(false);

    pendingForwarders = 0;
    await expect(terminal).resolves.toBe(result);
    expect(settled).toBe(true);
  });
});

describe('runAgent event-driven terminal flow', () => {
  it('records queued turn ordering with session idle boundaries', async () => {
    const definition = createAgent('queued-events');
    const fake = new FakeAgentAdapter({ output: validSystemOutput() });
    fake.setQueuedRun([
      [
        {
          type: 'thinking',
          timestamp: '2026-01-01T00:00:00Z',
          data: { content: 'first turn' },
        },
      ],
      [
        {
          type: 'message',
          timestamp: '2026-01-01T00:00:01Z',
          data: { content: 'second turn' },
        },
      ],
    ]);

    const seenEvents: AgentEvent[] = [];
    const result = await runAgent(
      fake,
      definition,
      { slug: 'queued-events' },
      (event) => seenEvents.push(event),
      tmpDir,
    );

    expect(result.metadata.result).toBe('completed');
    expect(seenEvents.map((event) => event.type)).toEqual([
      'thinking',
      'session_idle',
      'message',
      'session_idle',
    ]);

    const eventsPath = path.join(result.runDir, 'events.ndjson');
    const persistedTypes = fs
      .readFileSync(eventsPath, 'utf-8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line).type);
    expect(persistedTypes).toEqual([
      'thinking',
      'session_idle',
      'message',
      'session_idle',
    ]);
  });

  it('uses the runner timeout as the outer terminal guard', async () => {
    const definition = createAgent('timeout-events');
    const fake = new FakeAgentAdapter({
      output: validSystemOutput(),
      sessionId: 'slow-session',
      runDuration: 500,
    });

    const result = await runAgent(
      fake,
      definition,
      { slug: 'timeout-events', timeout: 0.01 },
      undefined,
      tmpDir,
    );

    expect(result.metadata.result).toBe('timeout');
    expect(result.metadata.exitCode).toBe(124);
    expect(fake.getRunHistory()).toHaveLength(1);
    expect(fake.getTerminateHistory()).toHaveLength(1);
  });

  it('starts coordinated forwarders through onSessionReady and cold-drains inbox and state', async () => {
    const definition = createAgent('coordinated-run', { coordination: true });
    const fake = new SeededFakeAgentAdapter(
      { output: validSystemOutput() },
      (runDir) => {
        writeOutsideInbox('coordinated-run', runDir, 'Cold inbox');
        writeOutsideState('coordinated-run', runDir);
      },
    );

    const result = await runAgent(
      fake,
      definition,
      { slug: 'coordinated-run' },
      undefined,
      tmpDir,
    );

    expect(result.metadata.result).toBe('completed');
    expect(fake.getSessionSendHistory()).toHaveLength(2);
    expect(fake.getSessionSendHistory()[0]).toContain('Subject: Cold inbox');
    expect(fake.getSessionSendHistory()[1]).toContain(
      '## Outside state changed',
    );
    const watermark = readForwarderWatermark({
      slug: 'coordinated-run',
      agentsDir: tmpDir,
      runId: path.basename(result.runDir),
    }).value;
    expect(watermark.inbox.outsideOffset).toBeGreaterThan(0);
    expect(watermark.state.outsideFingerprint).not.toBeNull();
  });

  it('does not produce spurious sends for coordinated agents with empty inbox and state', async () => {
    const definition = createAgent('empty-coordination', {
      coordination: true,
    });
    const fake = new FakeAgentAdapter({ output: validSystemOutput() });

    const result = await runAgent(
      fake,
      definition,
      { slug: 'empty-coordination' },
      undefined,
      tmpDir,
    );

    expect(result.metadata.result).toBe('completed');
    expect(fake.getSessionSendHistory()).toEqual([]);
  });

  it('releases the coordinated run lock after timeout cleanup', async () => {
    const definition = createAgent('timeout-coordination', {
      coordination: true,
    });
    const slow = new FakeAgentAdapter({
      output: validSystemOutput(),
      sessionId: 'slow-session',
      runDuration: 500,
    });

    const timedOut = await runAgent(
      slow,
      definition,
      { slug: 'timeout-coordination', timeout: 0.01 },
      undefined,
      tmpDir,
    );
    expect(timedOut.metadata.result).toBe('timeout');

    const next = new FakeAgentAdapter({ output: validSystemOutput() });
    const recovered = await runAgent(
      next,
      definition,
      { slug: 'timeout-coordination' },
      undefined,
      tmpDir,
    );

    expect(recovered.metadata.result).toBe('completed');
  });

  it('waits for pending forwarder sends after adapter idle before completing', async () => {
    const definition = createAgent('terminal-drain', { coordination: true });
    const adapter = new PendingSendAdapter(false, (runDir) =>
      writeOutsideInbox('terminal-drain', runDir, 'Wait for me'),
    );
    let settled = false;

    const run = runAgent(
      adapter,
      definition,
      { slug: 'terminal-drain' },
      undefined,
      tmpDir,
    ).then((result) => {
      settled = true;
      return result;
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(adapter.prompts).toHaveLength(1);
    expect(settled).toBe(false);

    adapter.release();
    const result = await run;

    expect(result.metadata.result).toBe('completed');
    expect(settled).toBe(true);
  });

  it('times out and terminates when a pending forwarder send never drains', async () => {
    const definition = createAgent('terminal-timeout', { coordination: true });
    const adapter = new PendingSendAdapter(false, (runDir) =>
      writeOutsideInbox('terminal-timeout', runDir, 'Never resolves'),
    );

    const result = await runAgent(
      adapter,
      definition,
      { slug: 'terminal-timeout', timeout: 0.01 },
      undefined,
      tmpDir,
    );

    expect(result.metadata.result).toBe('timeout');
    expect(adapter.terminateHistory).toEqual(['pending-session']);
  });

  it('does not commit forwarder watermarks when the coordinated run times out after send', async () => {
    const definition = createAgent('timeout-after-send', {
      coordination: true,
    });
    const adapter = new TimeoutAfterSendAdapter((runDir) =>
      writeOutsideInbox('timeout-after-send', runDir, 'Do not commit'),
    );

    const result = await runAgent(
      adapter,
      definition,
      { slug: 'timeout-after-send', timeout: 0.01 },
      undefined,
      tmpDir,
    );

    expect(result.metadata.result).toBe('timeout');
    expect(adapter.prompts).toHaveLength(1);
    expect(adapter.terminateHistory).toEqual(['timeout-after-send-session']);
    expect(
      readForwarderWatermark({
        slug: 'timeout-after-send',
        agentsDir: tmpDir,
        runId: path.basename(result.runDir),
      }).value.inbox.outsideOffset,
    ).toBe(0);
  });
});
