import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  coordinationEnvKeys,
  loadMcpContext,
  MCP_ENV_KEYS,
  McpContextError,
} from '../../src/mcp/context.js';
import {
  errorResult,
  isMcpToolName,
  jsonResult,
  MCP_TOOL_NAMES,
  McpToolError,
  TOOL_CONTRACTS,
} from '../../src/mcp/types.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-mcp-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('MCP tool contracts', () => {
  it('defines exactly the six inside coordination tools', () => {
    expect(MCP_TOOL_NAMES).toEqual([
      'inbox_list',
      'inbox_send',
      'inbox_ack',
      'state_get',
      'state_set',
      'state_transition',
    ]);
    expect(TOOL_CONTRACTS.map((tool) => tool.name)).toEqual(MCP_TOOL_NAMES);
    expect(MCP_TOOL_NAMES.every((name) => /^[a-zA-Z0-9_-]+$/.test(name))).toBe(
      true,
    );
  });

  it('identifies supported tool names', () => {
    expect(isMcpToolName('inbox_list')).toBe(true);
    expect(isMcpToolName('inbox.list')).toBe(false);
    expect(isMcpToolName('outside.list')).toBe(false);
  });

  it('keeps result and error envelopes JSON/text compatible', () => {
    expect(jsonResult({ ok: true })).toEqual({
      content: [{ type: 'text', text: '{"ok":true}' }],
      structuredContent: { ok: true },
    });

    expect(
      errorResult(new McpToolError('MCP_INVALID_ARGUMENT', 'bad input')),
    ).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'bad input' }],
      _meta: { code: 'MCP_INVALID_ARGUMENT' },
    });
  });
});

describe('loadMcpContext', () => {
  it('reuses the runner coordination env keys', () => {
    expect(coordinationEnvKeys()).toEqual([
      'MINIH_INBOX_DIR',
      'MINIH_STATE_DIR',
      'MINIH_CONTEXT',
    ]);
  });

  it('loads validated inside context from baked env', () => {
    const env = makeEnv();
    expect(loadMcpContext(env)).toMatchObject({
      context: 'inside',
      side: 'inside',
      runId: 'run-123',
      agentSlug: 'code-review',
      processMarker: 'minih-mcp-run-123',
    });
  });

  it('rejects missing required env with a typed code', () => {
    const env = makeEnv();
    delete env.MINIH_STATE_DIR;

    expect(() => loadMcpContext(env)).toThrow(McpContextError);
    try {
      loadMcpContext(env);
    } catch (err) {
      expect((err as McpContextError).code).toBe('MCP_CONTEXT_INVALID');
      expect((err as Error).message).toContain('MINIH_STATE_DIR');
    }
  });

  it('rejects non-absolute path values without echoing the value', () => {
    const env = makeEnv();
    env.MINIH_INBOX_DIR = 'relative/inbox';

    expectRedactedContextError(env, 'relative/inbox');
  });

  it('rejects run directories outside the target agent runs directory', () => {
    const env = makeEnv();
    env[MCP_ENV_KEYS.runDir] = path.join(tmpDir, 'other-run');
    fs.mkdirSync(env[MCP_ENV_KEYS.runDir], { recursive: true });

    expectRedactedContextError(env, env[MCP_ENV_KEYS.runDir]);
  });

  it('rejects symlink escapes for coordination directories', () => {
    const env = makeEnv();
    const outside = path.join(tmpDir, 'outside-state');
    fs.mkdirSync(outside, { recursive: true });
    fs.rmSync(env.MINIH_STATE_DIR, { recursive: true, force: true });
    fs.symlinkSync(outside, env.MINIH_STATE_DIR);

    expectRedactedContextError(env, outside);
  });

  it('requires the inside context', () => {
    const env = makeEnv();
    env.MINIH_CONTEXT = 'outside';

    expectRedactedContextError(env, 'outside');
  });
});

function makeEnv(): Record<string, string> {
  const agentsDir = path.join(tmpDir, 'agents');
  const agentSlug = 'code-review';
  const agentDir = path.join(agentsDir, agentSlug);
  const runDir = path.join(agentDir, 'runs', 'run-123');
  const inboxDir = path.join(runDir, 'inbox');
  const stateDir = path.join(runDir, 'state');
  for (const dir of [runDir, inboxDir, stateDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return {
    MINIH_INBOX_DIR: inboxDir,
    MINIH_STATE_DIR: stateDir,
    MINIH_CONTEXT: 'inside',
    [MCP_ENV_KEYS.runId]: 'run-123',
    [MCP_ENV_KEYS.runDir]: runDir,
    [MCP_ENV_KEYS.agentSlug]: agentSlug,
    [MCP_ENV_KEYS.agentsDir]: agentsDir,
    [MCP_ENV_KEYS.processMarker]: 'minih-mcp-run-123',
  };
}

function expectRedactedContextError(
  env: Record<string, string>,
  forbiddenValue: string | undefined,
): void {
  try {
    loadMcpContext(env);
    throw new Error('expected loadMcpContext to fail');
  } catch (err) {
    expect(err).toBeInstanceOf(McpContextError);
    expect((err as McpContextError).code).toBe('MCP_CONTEXT_INVALID');
    expect((err as Error).message).not.toContain(tmpDir);
    if (forbiddenValue !== undefined) {
      expect((err as Error).message).not.toContain(forbiddenValue);
    }
  }
}
