import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  AgentResult,
  AgentRunOptions,
  IAgentAdapter,
} from '../../src/adapter/index.js';
import {
  coordinationRunLocation,
  inboxLanePath,
  resolveAgent,
  stateFilePath,
} from '../../src/runner/index.js';
import { runAgent } from '../../src/runner/runner.js';
import { validSystemOutput } from '../helpers/fixtures.js';

const runE2e = process.env.MINIH_E2E === '1';
const describeE2e = runE2e ? describe : describe.skip;

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-daemon-light-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

class LiveForwarderAdapter implements IAgentAdapter {
  readonly prompts: string[] = [];

  constructor(
    private readonly writeFromSibling: (runDir: string) => Promise<void>,
  ) {}

  async run(options: AgentRunOptions): Promise<AgentResult> {
    options.onEvent?.({
      type: 'session_start',
      timestamp: '2026-04-26T00:00:00Z',
      data: { sessionId: 'daemon-light-session' },
    });
    options.onSessionReady?.({
      send: async (prompt: string): Promise<string> => {
        this.prompts.push(prompt);
        return 'ok';
      },
    });

    if (!options.cwd) throw new Error('expected run cwd');
    await this.writeFromSibling(options.cwd);
    await waitFor(
      () =>
        this.prompts.some((prompt) =>
          prompt.includes('Subject: Cross process'),
        ) &&
        this.prompts.some((prompt) =>
          prompt.includes('## Outside state changed'),
        ),
      5000,
    );

    options.onEvent?.({
      type: 'session_idle',
      timestamp: '2026-04-26T00:00:01Z',
      data: { sessionId: 'daemon-light-session' },
    });

    return {
      output: validSystemOutput(),
      sessionId: 'daemon-light-session',
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

describeE2e('daemon-light coordination e2e', () => {
  it('forwards sibling-process inbox and state writes into the live session', async () => {
    const slug = 'daemon-light';
    const agentDir = path.join(tmpDir, slug);
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentDir, 'prompt.md'),
      `---\ndescription: "Daemon light e2e"\ncoordination: enabled\n---\n\n# Daemon light`,
    );
    const definition = resolveAgent(slug, tmpDir);
    if (!definition) throw new Error('expected daemon-light agent to resolve');

    const adapter = new LiveForwarderAdapter((runDir) =>
      writeCoordinationFilesFromSibling(
        inboxLanePath(
          coordinationRunLocation(slug, tmpDir, path.basename(runDir)),
          'outside',
        ),
        stateFilePath(
          coordinationRunLocation(slug, tmpDir, path.basename(runDir)),
          'outside',
        ),
      ),
    );

    const result = await runAgent(
      adapter,
      definition,
      { slug, timeout: 10 },
      undefined,
      tmpDir,
    );

    expect(result.metadata.result).toBe('completed');
    expect(adapter.prompts).toHaveLength(2);
    expect(adapter.prompts[0]).toContain('Subject: Cross process');
    expect(adapter.prompts[1]).toContain('"milestone":2');
  });
});

async function writeCoordinationFilesFromSibling(
  inboxPath: string,
  outsideStatePath: string,
): Promise<void> {
  const script = `
const fs = require('node:fs');
const path = require('node:path');
const [inboxPath, outsideStatePath] = process.argv.slice(1);
fs.mkdirSync(path.dirname(inboxPath), { recursive: true });
fs.appendFileSync(inboxPath, JSON.stringify({
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  sender: 'outside',
  type: 'note',
  subject: 'Cross process',
  body: 'Written by a sibling process.',
  ts: '2026-04-26T00:00:00Z'
}) + '\\n');
fs.mkdirSync(path.dirname(outsideStatePath), { recursive: true });
fs.writeFileSync(outsideStatePath, JSON.stringify({
  status: 'in-progress',
  data: { milestone: 2 },
  updatedAt: '2026-04-26T00:00:01Z',
  updatedBy: 'outside'
}));
`;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['-e', script, inboxPath, outsideStatePath],
      {
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`sibling writer exited with ${code}: ${stderr}`));
    });
  });
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
