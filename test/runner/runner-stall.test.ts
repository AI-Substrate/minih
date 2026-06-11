/**
 * Plan 026 — stall watchdog + run budgets (T005a/T006a red tests).
 *
 * A run whose provider stream silently stops advancing must still reach
 * a guaranteed terminal artifact (#44). Sub-second budgets only — never
 * the 300s default in tests.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  AgentEvent,
  AgentResult,
  AgentRunOptions,
  IAgentAdapter,
} from '../../src/adapter/index.js';
import { resolveAgent } from '../../src/runner/folder.js';
import { runAgent } from '../../src/runner/runner.js';
import { validSystemOutput } from '../helpers/fixtures.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-runner-stall-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function createAgent(slug: string) {
  const agentDir = path.join(tmpDir, slug);
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, 'prompt.md'),
    `---\ndescription: "Stall watchdog test agent"\n---\n\n# ${slug}\n\nDo the thing.`,
  );
  const definition = resolveAgent(slug, tmpDir);
  if (!definition) throw new Error(`expected agent ${slug} to resolve`);
  return definition;
}

function event(type: AgentEvent['type'], data: object = {}): AgentEvent {
  return {
    type,
    timestamp: new Date().toISOString(),
    data,
  } as AgentEvent;
}

/**
 * Emits scripted events at real-clock offsets. A run with no `settleAtMs`
 * never settles — the silent-stall shape from #44 where neither
 * session.idle nor session.error ever arrives.
 */
class ScriptedAdapter implements IAgentAdapter {
  readonly terminateHistory: string[] = [];

  constructor(
    private readonly script: Array<{ atMs: number; event: AgentEvent }>,
    private readonly opts: {
      settleAtMs?: number;
      result?: Partial<AgentResult>;
    } = {},
  ) {}

  async run(options: AgentRunOptions): Promise<AgentResult> {
    for (const step of this.script) {
      setTimeout(() => options.onEvent?.(step.event), step.atMs);
    }
    if (this.opts.settleAtMs === undefined) {
      return new Promise<never>(() => {});
    }
    await new Promise((resolve) => setTimeout(resolve, this.opts.settleAtMs));
    return {
      output: this.opts.result?.output ?? '',
      sessionId: this.opts.result?.sessionId ?? 'scripted-session',
      status: this.opts.result?.status ?? 'completed',
      exitCode: this.opts.result?.exitCode ?? 0,
      tokens: null,
    };
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
      exitCode: 137,
      tokens: null,
    };
  }
}

/**
 * FT-002 (plan 026 review F002) — emits its whole script synchronously
 * INSIDE run(), before returning a never-settling promise. Models an
 * adapter whose events would beat the budget race arms if those arms were
 * wired up only after adapter.run() had been invoked.
 */
class SyncEmitAdapter implements IAgentAdapter {
  readonly terminateHistory: string[] = [];

  constructor(private readonly events: AgentEvent[]) {}

  run(options: AgentRunOptions): Promise<AgentResult> {
    for (const e of this.events) options.onEvent?.(e);
    return new Promise<never>(() => {});
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
      exitCode: 137,
      tokens: null,
    };
  }
}

function readManifest(runDir: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf-8'));
}

function readEventTypes(runDir: string): string[] {
  const eventsPath = path.join(runDir, 'events.ndjson');
  if (!fs.existsSync(eventsPath)) return [];
  return fs
    .readFileSync(eventsPath, 'utf-8')
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line).type as string);
}

describe('stall watchdog (plan 026 T005)', () => {
  it('terminalizes a silent stall: failed / stalled-stream / run_stalled / exit 124', async () => {
    const def = createAgent('stall-silent');
    const adapter = new ScriptedAdapter([
      { atMs: 0, event: event('thinking', { content: 'working…' }) },
      { atMs: 30, event: event('message', { content: 'partial answer' }) },
      // …then the stream goes silent forever.
    ]);
    const seen: AgentEvent[] = [];

    const started = Date.now();
    const result = await runAgent(
      adapter,
      def,
      { slug: 'stall-silent', stallTimeout: 0.2, timeout: 10 },
      (e) => seen.push(e),
      tmpDir,
    );

    expect(Date.now() - started).toBeLessThan(5000);
    expect(result.metadata.result).toBe('failed');
    expect(result.metadata.exitCode).toBe(124);
    expect(result.agentResult.output).toContain('stalled');
    expect(adapter.terminateHistory.length).toBeGreaterThan(0);

    const manifest = readManifest(result.runDir);
    expect(manifest.status).toBe('failed');
    expect(manifest.terminalReason).toBe('stalled-stream');
    // AC-6 — the effective budgets are recorded in run.json.
    expect(manifest.budgets).toEqual({
      timeoutSec: 10,
      stallTimeoutSec: 0.2,
      maxTurns: 0,
    });

    // Exactly one synthetic run_stalled — emitted from the race arm, so it
    // can neither reset the deadline nor re-trigger the arm.
    const persisted = readEventTypes(result.runDir);
    expect(persisted.filter((t) => t === 'run_stalled')).toHaveLength(1);
    expect(seen.filter((e) => e.type === 'run_stalled')).toHaveLength(1);

    expect(fs.existsSync(path.join(result.runDir, 'completed.json'))).toBe(
      true,
    );
  });

  it('never false-triggers while events of any type keep flowing', async () => {
    const def = createAgent('stall-flowing');
    // Total run 400ms > stall budget 250ms, but no inter-event gap exceeds it.
    const adapter = new ScriptedAdapter(
      [
        {
          atMs: 0,
          event: event('tool_call', {
            toolName: 'x',
            toolCallId: 't1',
            input: {},
          }),
        },
        { atMs: 100, event: event('thinking', { content: 'hmm' }) },
        {
          atMs: 200,
          event: event('tool_result', {
            toolCallId: 't1',
            output: 'ok',
            isError: false,
          }),
        },
        { atMs: 300, event: event('message', { content: 'done' }) },
        { atMs: 350, event: event('session_idle') },
      ],
      { settleAtMs: 400, result: { output: validSystemOutput() } },
    );

    const result = await runAgent(
      adapter,
      def,
      { slug: 'stall-flowing', stallTimeout: 0.25, timeout: 10 },
      undefined,
      tmpDir,
    );

    expect(result.metadata.result).toBe('completed');
    const manifest = readManifest(result.runDir);
    expect(manifest.terminalReason).toBeUndefined();
    expect(readEventTypes(result.runDir)).not.toContain('run_stalled');
  });

  it('--stall-timeout 0 disables the watchdog (wall-clock timeout still backstops)', async () => {
    const def = createAgent('stall-disabled');
    const adapter = new ScriptedAdapter([]); // fully silent, never settles

    const result = await runAgent(
      adapter,
      def,
      { slug: 'stall-disabled', stallTimeout: 0, timeout: 0.3 },
      undefined,
      tmpDir,
    );

    expect(result.metadata.result).toBe('timeout');
    const manifest = readManifest(result.runDir);
    expect(manifest.terminalReason).toBe('timeout');
    expect(readEventTypes(result.runDir)).not.toContain('run_stalled');
  });

  it('idle-before-stall: a clean completion under the budget stays clean', async () => {
    const def = createAgent('stall-clean');
    const adapter = new ScriptedAdapter(
      [
        { atMs: 0, event: event('message', { content: 'fast answer' }) },
        { atMs: 20, event: event('session_idle') },
      ],
      { settleAtMs: 40, result: { output: validSystemOutput() } },
    );

    const result = await runAgent(
      adapter,
      def,
      { slug: 'stall-clean', stallTimeout: 0.5, timeout: 10 },
      undefined,
      tmpDir,
    );

    expect(result.metadata.result).toBe('completed');
    expect(readManifest(result.runDir).terminalReason).toBeUndefined();
  });

  it('wall-clock timeout that fires first wins the race over the stall arm', async () => {
    const def = createAgent('stall-vs-timeout');
    const adapter = new ScriptedAdapter([]); // silent, never settles

    const result = await runAgent(
      adapter,
      def,
      { slug: 'stall-vs-timeout', stallTimeout: 5, timeout: 0.15 },
      undefined,
      tmpDir,
    );

    expect(result.metadata.result).toBe('timeout');
    const manifest = readManifest(result.runDir);
    expect(manifest.terminalReason).toBe('timeout');
    expect(readEventTypes(result.runDir)).not.toContain('run_stalled');
  });
});

describe('max-turns budget (plan 026 T006)', () => {
  it('terminalizes failed / max-turns when consolidated messages exceed the budget', async () => {
    const def = createAgent('turns-breach');
    // Three consolidated assistant messages against maxTurns: 2; the
    // stream keeps flowing (no stall) and never settles on its own.
    const adapter = new ScriptedAdapter([
      { atMs: 0, event: event('message', { content: 'turn 1' }) },
      { atMs: 40, event: event('message', { content: 'turn 2' }) },
      { atMs: 80, event: event('message', { content: 'turn 3' }) },
    ]);

    const started = Date.now();
    const result = await runAgent(
      adapter,
      def,
      { slug: 'turns-breach', maxTurns: 2, stallTimeout: 5, timeout: 10 },
      undefined,
      tmpDir,
    );

    expect(Date.now() - started).toBeLessThan(5000);
    expect(result.metadata.result).toBe('failed');
    expect(result.metadata.exitCode).toBe(124);
    expect(result.agentResult.output).toContain('max-turns');
    expect(adapter.terminateHistory.length).toBeGreaterThan(0);

    const manifest = readManifest(result.runDir);
    expect(manifest.status).toBe('failed');
    expect(manifest.terminalReason).toBe('max-turns');
    expect(fs.existsSync(path.join(result.runDir, 'completed.json'))).toBe(
      true,
    );
  });

  it('a run at exactly the budget is unaffected — a turn is one consolidated message, chunking-independent', async () => {
    const def = createAgent('turns-at-budget');
    // Two consolidated messages (= maxTurns) surrounded by deltas, tool
    // events, and thinking — none of which count as turns.
    const adapter = new ScriptedAdapter(
      [
        {
          atMs: 0,
          event: event('text_delta', { content: 'chunk a', messageId: 'm1' }),
        },
        {
          atMs: 10,
          event: event('text_delta', { content: 'chunk b', messageId: 'm1' }),
        },
        {
          atMs: 20,
          event: event('message', { content: 'turn 1', messageId: 'm1' }),
        },
        {
          atMs: 30,
          event: event('tool_call', {
            toolName: 'x',
            toolCallId: 't1',
            input: {},
          }),
        },
        {
          atMs: 40,
          event: event('tool_result', {
            toolCallId: 't1',
            output: 'ok',
            isError: false,
          }),
        },
        { atMs: 50, event: event('thinking', { content: 'hmm' }) },
        {
          atMs: 60,
          event: event('message', { content: 'turn 2', messageId: 'm2' }),
        },
        { atMs: 70, event: event('session_idle') },
      ],
      { settleAtMs: 100, result: { output: validSystemOutput() } },
    );

    const result = await runAgent(
      adapter,
      def,
      { slug: 'turns-at-budget', maxTurns: 2, stallTimeout: 5, timeout: 10 },
      undefined,
      tmpDir,
    );

    expect(result.metadata.result).toBe('completed');
    expect(readManifest(result.runDir).terminalReason).toBeUndefined();
  });

  it('maxTurns 0 (and unset) means unlimited', async () => {
    const def = createAgent('turns-unlimited');
    const adapter = new ScriptedAdapter(
      [
        { atMs: 0, event: event('message', { content: 'turn 1' }) },
        { atMs: 20, event: event('message', { content: 'turn 2' }) },
        { atMs: 40, event: event('message', { content: 'turn 3' }) },
        { atMs: 60, event: event('session_idle') },
      ],
      { settleAtMs: 90, result: { output: validSystemOutput() } },
    );

    const result = await runAgent(
      adapter,
      def,
      { slug: 'turns-unlimited', maxTurns: 0, stallTimeout: 5, timeout: 10 },
      undefined,
      tmpDir,
    );

    expect(result.metadata.result).toBe('completed');
    expect(readManifest(result.runDir).terminalReason).toBeUndefined();
  });

  // FT-002 (plan 026 review F002) — the budget race arms must exist before
  // adapter.run() is invoked: an adapter that emits its turns synchronously
  // during run() startup must still trip --max-turns rather than drift into
  // the stall arm.
  it('trips max-turns for events emitted synchronously during adapter.run()', async () => {
    const def = createAgent('turns-sync');
    const adapter = new SyncEmitAdapter([
      event('message', { content: 'one' }),
      event('message', { content: 'two' }),
      event('message', { content: 'three' }),
    ]);

    const result = await runAgent(
      adapter,
      def,
      { slug: 'turns-sync', maxTurns: 2, stallTimeout: 0.3, timeout: 10 },
      undefined,
      tmpDir,
    );

    expect(result.metadata.result).toBe('failed');
    expect(result.metadata.exitCode).toBe(124);
    expect(result.agentResult.output).toContain('max-turns');
    expect(readManifest(result.runDir).terminalReason).toBe('max-turns');
  });
});
