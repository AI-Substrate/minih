import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeAgentAdapter } from '../../src/adapter/index.js';
import { resolveAgent } from '../../src/runner/folder.js';
import { runAgent } from '../../src/runner/runner.js';
import type { AgentDefinition } from '../../src/runner/types.js';
import { validSystemOutput } from '../helpers/fixtures.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-mcp-coexist-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('inside MCP coexistence', () => {
  it('merges the inside MCP server into coordinated runs with user servers', async () => {
    const definition = createAgent('code-review', true);
    const adapter = new FakeAgentAdapter({ output: validSystemOutput() });

    await runAgent(
      adapter,
      definition,
      {
        slug: 'code-review',
        mcpServers: {
          'user-echo': { command: 'node', args: ['echo.js'], tools: ['*'] },
        },
        insideMcpServerFactory: ({ runId }) => ({
          'minih-coordination': {
            command: 'node',
            args: ['server.js'],
            tools: ['*'],
            env: { MINIH_MCP_RUN_ID: runId },
          },
        }),
        reservedMcpToolPrefixes: ['inbox.', 'state.'],
      },
      undefined,
      tmpDir,
    );

    expect(adapter.getRunHistory()[0].mcpServers).toMatchObject({
      'user-echo': { command: 'node' },
      'minih-coordination': {
        command: 'node',
        env: expect.objectContaining({ MINIH_MCP_RUN_ID: expect.any(String) }),
      },
    });
  });

  it('does not add the inside MCP server for non-coordinated agents', async () => {
    const definition = createAgent('smoke-test', false);
    const adapter = new FakeAgentAdapter({ output: validSystemOutput() });
    let factoryCalled = false;

    await runAgent(
      adapter,
      definition,
      {
        slug: 'smoke-test',
        cwd: tmpDir,
        insideMcpServerFactory: () => {
          factoryCalled = true;
          return { 'minih-coordination': { command: 'node' } };
        },
      },
      undefined,
      tmpDir,
    );

    expect(factoryCalled).toBe(false);
    expect(adapter.getRunHistory()[0].mcpServers).toBeUndefined();
  });

  it('fails clearly when user config uses the reserved inside server name', async () => {
    const definition = createAgent('code-review', true);
    const adapter = new FakeAgentAdapter({ output: validSystemOutput() });

    const result = await runAgent(
      adapter,
      definition,
      {
        slug: 'code-review',
        mcpServers: {
          'minih-coordination': { command: 'node', args: ['user.js'] },
        },
        insideMcpServerFactory: () => ({
          'minih-coordination': { command: 'node', args: ['internal.js'] },
        }),
      },
      undefined,
      tmpDir,
    );

    expect(result.agentResult.status).toBe('failed');
    expect(result.agentResult.output).toContain(
      'MCP server name "minih-coordination" is reserved',
    );
    expect(adapter.getRunHistory()).toHaveLength(0);
  });

  it('fails clearly when user config declares reserved inbox/state tools', async () => {
    const definition = createAgent('code-review', true);
    const adapter = new FakeAgentAdapter({ output: validSystemOutput() });

    const result = await runAgent(
      adapter,
      definition,
      {
        slug: 'code-review',
        mcpServers: {
          custom: { command: 'node', tools: ['inbox.list'] },
        },
        insideMcpServerFactory: () => ({
          'minih-coordination': { command: 'node', tools: ['*'] },
        }),
        reservedMcpToolPrefixes: ['inbox.', 'state.'],
      },
      undefined,
      tmpDir,
    );

    expect(result.agentResult.status).toBe('failed');
    expect(result.agentResult.output).toContain(
      'reserved tool namespace "inbox.*"',
    );
    expect(adapter.getRunHistory()).toHaveLength(0);
  });

  it('keeps runner source independent of the mcp domain', () => {
    const runnerSource = fs.readFileSync(
      path.join(__dirname, '../../src/runner/runner.ts'),
      'utf8',
    );

    expect(runnerSource).not.toMatch(/from ['"].*mcp/);
  });
});

function createAgent(slug: string, coordination: boolean): AgentDefinition {
  const agentDir = path.join(tmpDir, slug);
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, 'prompt.md'),
    `---\ndescription: "MCP coexistence test"\n${coordination ? 'coordination: enabled\n' : ''}---\n\n# ${slug}\n\nDo the thing.`,
  );
  const definition = resolveAgent(slug, tmpDir);
  if (!definition) throw new Error(`expected ${slug} to resolve`);
  return definition;
}
