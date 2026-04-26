import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type AgentEvent,
  type AgentResult,
  FakeAgentAdapter,
} from '../../src/adapter/index.js';
import { resolveAgent } from '../../src/runner/folder.js';
import { awaitTerminalCondition, runAgent } from '../../src/runner/runner.js';
import { validSystemOutput } from '../helpers/fixtures.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-runner-events-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function createAgent(slug: string) {
  const agentDir = path.join(tmpDir, slug);
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, 'prompt.md'),
    `---\ndescription: "Event-driven test agent"\n---\n\n# ${slug}\n\nDo the thing.`,
  );

  const definition = resolveAgent(slug, tmpDir);
  if (!definition) {
    throw new Error(`expected agent ${slug} to resolve`);
  }
  return definition;
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
});
