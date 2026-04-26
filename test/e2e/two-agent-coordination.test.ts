import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  AgentResult,
  AgentRunOptions,
  IAgentAdapter,
  SessionSender,
} from '../../src/adapter/index.js';
import { inboxLanePath, resolveAgent } from '../../src/runner/folder.js';
import { runAgent } from '../../src/runner/runner.js';
import { writeState } from '../../src/runner/state.js';
import type { InboxMessage, InsideState } from '../../src/runner/types.js';

const runE2e = process.env.MINIH_E2E === '1';
const describeE2e = runE2e ? describe : describe.skip;
const repoRoot = path.resolve('.');
const cliPath = path.join(repoRoot, 'dist/cli/index.js');
const slug = 'coordination-smoke-test';

let tmpDir: string;
let agentsDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-two-agent-e2e-'));
  agentsDir = path.join(tmpDir, 'agents');
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.cpSync(path.join(repoRoot, 'agents', slug), path.join(agentsDir, slug), {
    recursive: true,
  });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

class CoordinatedSmokeAdapter implements IAgentAdapter {
  readonly forwardedPrompts: string[] = [];

  async run(options: AgentRunOptions): Promise<AgentResult> {
    const sender: SessionSender = {
      send: async (prompt: string): Promise<string> => {
        this.forwardedPrompts.push(prompt);
        return 'queued';
      },
    };
    options.onSessionReady?.(sender);

    await waitFor(
      () =>
        this.forwardedPrompts.some((prompt) =>
          prompt.includes('Subject: Smoke test request'),
        ) &&
        this.forwardedPrompts.some((prompt) =>
          prompt.includes('## Outside state changed'),
        ),
      5000,
    );

    appendInsideMessage({
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAA',
      sender: 'inside',
      type: 'note',
      subject: 'Smoke test complete',
      body: 'Verified outside request, state forwarding, inside reply, and final report.',
      ts: '2026-04-26T00:00:02Z',
    });
    const insideState: InsideState = {
      status: 'complete',
      data: { toolChecks: 6, verdict: 'all-pass' },
      updatedAt: '2026-04-26T00:00:03Z',
      updatedBy: 'inside',
    };
    writeState('inside', slug, agentsDir, insideState);

    return {
      output: JSON.stringify({
        summary:
          'The two-agent coordination smoke path observed outside input, sent inside evidence, and wrote final state.',
        toolChecks: [
          {
            tool: 'inbox.list',
            status: 'pass',
            evidence: 'outside request forwarded',
          },
          {
            tool: 'inbox.ack',
            status: 'pass',
            evidence: 'request acknowledged in simulated turn',
          },
          {
            tool: 'inbox.send',
            status: 'pass',
            evidence: 'inside reply appended',
          },
          {
            tool: 'state.get',
            status: 'pass',
            evidence: 'outside state forwarded',
          },
          {
            tool: 'state.set',
            status: 'pass',
            evidence: 'inside state written',
          },
          {
            tool: 'state.transition',
            status: 'pass',
            evidence: 'inside status complete',
          },
        ],
        verdict: 'all-pass',
        retrospective: {
          workedWell:
            'Outside CLI writes and inside runner observation composed cleanly.',
          confusing: 'Nothing was confusing in this e2e path.',
          magicWand:
            'Show a compact coordination transcript in completed run metadata.',
          magicWandTarget: 'coordination',
          coordination: {
            peerUpdatesSent: 1,
            unresolvedPeerRequests: 0,
            statePublished: true,
          },
        },
      }),
      sessionId: 'two-agent-session',
      status: 'completed',
      exitCode: 0,
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
    return {
      output: '',
      sessionId,
      status: 'killed',
      exitCode: 143,
      tokens: null,
    };
  }
}

describeE2e('two-agent coordination e2e', () => {
  it('drives the smoke-test agent through outside writes and verifies inside evidence', async () => {
    runCli([
      'outside-send',
      slug,
      '--type',
      'note',
      '--subject',
      'Smoke test request',
      '--body',
      'Please verify coordination.',
      '--agents-dir',
      agentsDir,
    ]);
    runCli([
      'state',
      'set',
      slug,
      '--side',
      'outside',
      '--status',
      'in-progress',
      '--data-json',
      '{"driver":"outside e2e"}',
      '--agents-dir',
      agentsDir,
    ]);

    const definition = resolveAgent(slug, agentsDir);
    if (!definition) throw new Error('expected coordination smoke agent');
    const adapter = new CoordinatedSmokeAdapter();
    const result = await runAgent(
      adapter,
      definition,
      { slug, timeout: 10, cwd: repoRoot },
      undefined,
      agentsDir,
    );

    expect(result.metadata.result).toBe('completed');
    expect(result.metadata.validated).toBe(true);
    expect(adapter.forwardedPrompts.join('\n')).toContain(
      'Subject: Smoke test request',
    );
    expect(adapter.forwardedPrompts.join('\n')).toContain(
      '"driver":"outside e2e"',
    );

    const replies = JSON.parse(
      runCli(['outside-inbox-list', slug, '--agents-dir', agentsDir]),
    );
    expect(replies.data.messages).toEqual([
      expect.objectContaining({
        sender: 'inside',
        subject: 'Smoke test complete',
      }),
    ]);

    const state = JSON.parse(
      runCli(['state', 'get', slug, '--agents-dir', agentsDir]),
    );
    expect(state.data.inside.status).toBe('complete');
    expect(state.data.outside.status).toBe('in-progress');

    const report = JSON.parse(
      fs.readFileSync(
        path.join(result.runDir, 'output', 'report.json'),
        'utf8',
      ),
    );
    expect(report.verdict).toBe('all-pass');
    expect(
      report.toolChecks.map((check: { tool: string }) => check.tool),
    ).toEqual([
      'inbox.list',
      'inbox.ack',
      'inbox.send',
      'state.get',
      'state.set',
      'state.transition',
    ]);
    expect(result.metadata.artifacts).toContain('state-snapshot.json');
    expect(result.metadata.artifacts).toContain('inbox-snapshot/inside.ndjson');
  });
});

function runCli(args: string[]): string {
  return execFileSync(process.execPath, [cliPath, ...args], {
    cwd: tmpDir,
    env: { ...process.env, NO_COLOR: '1' },
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function appendInsideMessage(message: InboxMessage): void {
  const target = inboxLanePath(slug, agentsDir, 'inside');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.appendFileSync(target, `${JSON.stringify(message)}\n`);
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`condition not met within ${timeoutMs}ms`);
}
