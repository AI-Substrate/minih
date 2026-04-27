import { type ChildProcess, execFile, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentResult, AgentRunOptions } from '../../src/adapter/events.js';
import type { IAgentAdapter } from '../../src/adapter/interface.js';
import { buildInsideMcpServerConfig } from '../../src/mcp/spawn.js';
import { MINIH_COORDINATION_SERVER_NAME } from '../../src/mcp/types.js';
import { resolveAgent } from '../../src/runner/folder.js';
import { runAgent } from '../../src/runner/runner.js';
import type {
  AgentDefinition,
  AgentRunResult,
} from '../../src/runner/types.js';
import { validSystemOutput } from '../helpers/fixtures.js';

const execFileAsync = promisify(execFile);
const runPgrep = process.env.MINIH_PGREP === '1';
const describePgrep = runPgrep ? describe : describe.skip;

let tmpDir: string;
let agentsDir: string;
const children = new Set<ChildProcess>();

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-mcp-leak-'));
  agentsDir = path.join(tmpDir, 'agents');
});

afterEach(async () => {
  for (const child of children) {
    await terminateChild(child, 'SIGTERM');
  }
  children.clear();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describePgrep('MCP process-marker leak regression', () => {
  it('cleans up after a coordinated runner success path', async () => {
    const { marker, result } = await runCoordinatedLeakScenario('success');

    expect(result.metadata.result).toBe('completed');
    await expectNoMarker(marker);
  });

  it('cleans up after a coordinated runner failure path', async () => {
    const { marker, result } = await runCoordinatedLeakScenario('failure');

    expect(result.metadata.result).toBe('failed');
    await expectNoMarker(marker);
  });

  it('cleans up after the coordinated runner timeout path calls terminate', async () => {
    const { marker, result } = await runCoordinatedLeakScenario(
      'timeout',
      0.05,
    );

    expect(result.metadata.result).toBe('timeout');
    await expectNoMarker(marker);
  });

  it('cleans up after a SIGINT-equivalent child shutdown path', async () => {
    const { marker, result } = await runCoordinatedLeakScenario('sigint');

    expect(result.metadata.result).toBe('completed');
    await expectNoMarker(marker);
  });
});

type LeakScenario = 'success' | 'failure' | 'timeout' | 'sigint';

async function runCoordinatedLeakScenario(
  scenario: LeakScenario,
  timeout = 5,
): Promise<{ marker: string; result: AgentRunResult }> {
  const definition = createAgent('code-review');
  const adapter = new SpawningMcpAdapter(scenario);
  let marker = '';

  const result = await runAgent(
    adapter,
    definition,
    {
      slug: definition.slug,
      cwd: tmpDir,
      timeout,
      insideMcpServerFactory: ({ runId, runDir, agentSlug, agentsDir }) => {
        marker = `minih-mcp-${runId}`;
        return buildInsideMcpServerConfig({
          runId,
          runDir,
          agentSlug,
          agentsDir,
        });
      },
      reservedMcpToolPrefixes: ['inbox_', 'state_'],
    },
    undefined,
    agentsDir,
  );

  if (marker === '') throw new Error('inside MCP factory was not called');
  return { marker, result };
}

class SpawningMcpAdapter implements IAgentAdapter {
  private child: ChildProcess | null = null;
  private marker = '';
  private resolveTerminate: (() => void) | null = null;

  constructor(private readonly scenario: LeakScenario) {}

  async run(options: AgentRunOptions): Promise<AgentResult> {
    options.onEvent?.({
      type: 'session_start',
      timestamp: new Date().toISOString(),
      data: { sessionId: 'leak-session' },
    });

    this.child = spawnConfiguredMcpServer(options.mcpServers);
    this.marker = readProcessMarker(options.mcpServers);
    await waitForMarker(this.marker);

    try {
      if (this.scenario === 'failure') {
        throw new Error('simulated adapter failure after MCP startup');
      }
      if (this.scenario === 'timeout') {
        await new Promise<void>((resolve) => {
          this.resolveTerminate = resolve;
        });
        return agentResult('killed', 143);
      }
      if (this.scenario === 'sigint') {
        await this.closeChild('SIGINT');
      }
      return agentResult('completed', 0);
    } finally {
      await this.closeChild('SIGTERM');
    }
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
    await this.closeChild('SIGTERM');
    this.resolveTerminate?.();
    this.resolveTerminate = null;
    return {
      output: '',
      sessionId,
      status: 'killed',
      exitCode: 143,
      tokens: null,
    };
  }

  private async closeChild(signal: NodeJS.Signals): Promise<void> {
    if (!this.child) return;
    await terminateChild(this.child, signal);
    this.child = null;
  }
}

function spawnConfiguredMcpServer(
  mcpServers: Record<string, unknown> | undefined,
): ChildProcess {
  const entry = readMinihMcpEntry(mcpServers);
  const command = entry.command === 'node' ? process.execPath : entry.command;
  const child = spawn(command, entry.args, {
    env: { ...process.env, ...entry.env },
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  children.add(child);
  child.once('exit', () => children.delete(child));
  return child;
}

function readMinihMcpEntry(mcpServers: Record<string, unknown> | undefined): {
  command: string;
  args: string[];
  env: Record<string, string>;
} {
  const entry = mcpServers?.[MINIH_COORDINATION_SERVER_NAME];
  if (!isRecord(entry)) throw new Error('missing minih MCP server entry');
  if (typeof entry.command !== 'string') {
    throw new Error('MCP server command must be a string');
  }
  if (!Array.isArray(entry.args) || !entry.args.every(isString)) {
    throw new Error('MCP server args must be strings');
  }
  if (!isStringRecord(entry.env)) {
    throw new Error('MCP server env must be a string record');
  }
  return {
    command: entry.command,
    args: entry.args,
    env: entry.env,
  };
}

function readProcessMarker(
  mcpServers: Record<string, unknown> | undefined,
): string {
  const marker = readMinihMcpEntry(mcpServers).env.MINIH_MCP_PROCESS_MARKER;
  if (!marker) throw new Error('MCP process marker missing from spawn config');
  return marker;
}

function agentResult(
  status: AgentResult['status'],
  exitCode: number,
): AgentResult {
  return {
    output: status === 'completed' ? validSystemOutput() : '',
    sessionId: 'leak-session',
    status,
    exitCode,
    tokens: null,
  };
}

function createAgent(slug: string): AgentDefinition {
  const agentDir = path.join(agentsDir, slug);
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, 'prompt.md'),
    `---\ndescription: "MCP leak regression test"\ncoordination: enabled\n---\n\n# ${slug}\n\nDo the thing.`,
  );
  const definition = resolveAgent(slug, agentsDir);
  if (!definition) throw new Error(`expected ${slug} to resolve`);
  return definition;
}

async function terminateChild(
  child: ChildProcess,
  signal: NodeJS.Signals,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (child.pid !== undefined) process.kill(child.pid, signal);
  await waitForExit(child);
}

async function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    child.once('exit', () => resolve());
    child.once('error', reject);
  });
}

async function waitForMarker(marker: string): Promise<void> {
  await waitFor(async () => (await pgrep(marker)).length > 0, 5000);
}

async function expectNoMarker(marker: string): Promise<void> {
  await waitFor(async () => (await pgrep(marker)).length === 0, 5000);
  expect(await pgrep(marker)).toEqual([]);
}

async function pgrep(marker: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('pgrep', ['-fl', marker]);
    return stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .filter((line) => !line.includes('pgrep'));
  } catch {
    return [];
  }
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`condition not met within ${timeoutMs}ms`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every(isString);
}
