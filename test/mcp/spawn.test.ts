import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildInsideMcpServerConfig,
  resolveInsideMcpServerEntry,
} from '../../src/mcp/spawn.js';
import { MINIH_COORDINATION_SERVER_NAME } from '../../src/mcp/types.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-mcp-spawn-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('buildInsideMcpServerConfig', () => {
  it('returns the minih-coordination stdio entry with minimal baked env', () => {
    const serverEntryPath = makeServerEntry('dist/mcp/server.js');
    const config = buildInsideMcpServerConfig({
      runId: 'run-123',
      runDir: path.join(tmpDir, 'agents', 'code-review', 'runs', 'run-123'),
      agentSlug: 'code-review',
      agentsDir: path.join(tmpDir, 'agents'),
      serverEntryPath,
    });

    const entry = config[MINIH_COORDINATION_SERVER_NAME];
    expect(entry.command).toBe('node');
    expect(entry.args).toEqual([serverEntryPath]);
    expect(entry.tools).toEqual(['*']);
    expect(entry.env).toEqual({
      MINIH: '1',
      MINIH_CONTEXT: 'inside',
      MINIH_INBOX_DIR: path.join(
        tmpDir,
        'agents',
        'code-review',
        'runs',
        'run-123',
        'inbox',
      ),
      MINIH_STATE_DIR: path.join(
        tmpDir,
        'agents',
        'code-review',
        'runs',
        'run-123',
        'state',
      ),
      NODE_NO_WARNINGS: '1',
      MINIH_MCP_RUN_ID: 'run-123',
      MINIH_MCP_RUN_DIR: path.join(
        tmpDir,
        'agents',
        'code-review',
        'runs',
        'run-123',
      ),
      MINIH_MCP_AGENT_SLUG: 'code-review',
      MINIH_MCP_AGENTS_DIR: path.join(tmpDir, 'agents'),
      MINIH_MCP_PROCESS_MARKER: 'minih-mcp-run-123',
    });
  });

  it('rejects relative or missing server artifacts clearly', () => {
    expect(() =>
      buildInsideMcpServerConfig({
        runId: 'run-123',
        runDir: tmpDir,
        agentSlug: 'code-review',
        agentsDir: tmpDir,
        serverEntryPath: 'dist/mcp/server.js',
      }),
    ).toThrow(/absolute/);

    expect(() =>
      buildInsideMcpServerConfig({
        runId: 'run-123',
        runDir: tmpDir,
        agentSlug: 'code-review',
        agentsDir: tmpDir,
        serverEntryPath: path.join(tmpDir, 'missing.js'),
      }),
    ).toThrow(/does not exist/);
  });

  it('rejects an empty node command override', () => {
    expect(() =>
      buildInsideMcpServerConfig({
        runId: 'run-123',
        runDir: tmpDir,
        agentSlug: 'code-review',
        agentsDir: tmpDir,
        serverEntryPath: makeServerEntry('server.js'),
        nodeCommand: ' ',
      }),
    ).toThrow(/command/);
  });
});

describe('resolveInsideMcpServerEntry', () => {
  it('resolves a packaged dist sibling next to spawn.js', () => {
    const serverEntry = makeServerEntry('package/dist/mcp/server.js');
    const spawnPath = makeServerEntry('package/dist/mcp/spawn.js');

    expect(resolveInsideMcpServerEntry(pathToFileURL(spawnPath).href)).toBe(
      serverEntry,
    );
  });

  it('resolves the built dist artifact when called from a source module', () => {
    const serverEntry = makeServerEntry('project/dist/mcp/server.js');
    const spawnPath = makeServerEntry('project/src/mcp/spawn.ts');

    expect(resolveInsideMcpServerEntry(pathToFileURL(spawnPath).href)).toBe(
      serverEntry,
    );
  });

  it('fails clearly when neither packaged nor built artifacts exist', () => {
    const spawnPath = makeServerEntry('project/src/mcp/spawn.ts');
    fs.rmSync(path.join(tmpDir, 'project', 'dist'), {
      recursive: true,
      force: true,
    });

    expect(() =>
      resolveInsideMcpServerEntry(pathToFileURL(spawnPath).href),
    ).toThrow(/npm run build/);
  });
});

function makeServerEntry(relativePath: string): string {
  const filePath = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '');
  return filePath;
}
