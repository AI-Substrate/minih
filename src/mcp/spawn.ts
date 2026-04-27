import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  coordinationRunLocation,
  inboxLanePath,
  stateFilePath,
} from '../runner/folder.js';
import { MCP_ENV_KEYS } from './context.js';
import { MINIH_COORDINATION_SERVER_NAME } from './types.js';

export interface BuildInsideMcpServerConfigOptions {
  runId: string;
  runDir: string;
  agentSlug: string;
  agentsDir: string;
  nodeCommand?: string;
  serverEntryPath?: string;
}

export interface MinihMcpServerEntry {
  command: 'node' | string;
  args: string[];
  env: Record<string, string>;
  tools: ['*'];
}

export function buildInsideMcpServerConfig(
  options: BuildInsideMcpServerConfigOptions,
): Record<typeof MINIH_COORDINATION_SERVER_NAME, MinihMcpServerEntry> {
  const command = options.nodeCommand ?? 'node';
  if (command.trim() === '') {
    throw new Error('MCP server command must not be empty');
  }

  const serverEntryPath =
    options.serverEntryPath ?? resolveInsideMcpServerEntry();
  assertExecutableServerEntry(serverEntryPath);

  const agentsDir = path.resolve(options.agentsDir);
  const runDir = path.resolve(options.runDir);
  const location = coordinationRunLocation(
    options.agentSlug,
    agentsDir,
    options.runId,
  );
  const inboxDir = path.dirname(
    path.dirname(inboxLanePath(location, 'inside')),
  );
  const stateDir = path.dirname(stateFilePath(location, 'inside'));

  return {
    [MINIH_COORDINATION_SERVER_NAME]: {
      command,
      args: [serverEntryPath],
      tools: ['*'],
      env: {
        MINIH: '1',
        MINIH_CONTEXT: 'inside',
        MINIH_INBOX_DIR: inboxDir,
        MINIH_STATE_DIR: stateDir,
        NODE_NO_WARNINGS: '1',
        [MCP_ENV_KEYS.runId]: options.runId,
        [MCP_ENV_KEYS.runDir]: runDir,
        [MCP_ENV_KEYS.agentSlug]: options.agentSlug,
        [MCP_ENV_KEYS.agentsDir]: agentsDir,
        [MCP_ENV_KEYS.processMarker]: `minih-mcp-${options.runId}`,
      },
    },
  };
}

export function resolveInsideMcpServerEntry(
  moduleUrl = import.meta.url,
): string {
  const modulePath = fileURLToPath(moduleUrl);
  const candidates = candidateServerEntryPaths(modulePath);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(
      'MCP server entry not found; run `npm run build` before spawning inside coordination tools',
    );
  }
  return path.resolve(found);
}

function candidateServerEntryPaths(modulePath: string): string[] {
  const moduleDir = path.dirname(modulePath);
  const repoRootFromSrc = path.resolve(moduleDir, '..', '..');
  return [
    path.join(moduleDir, 'server.js'),
    path.join(repoRootFromSrc, 'dist', 'mcp', 'server.js'),
  ];
}

function assertExecutableServerEntry(serverEntryPath: string): void {
  if (!path.isAbsolute(serverEntryPath)) {
    throw new Error('MCP server entry path must be absolute');
  }
  if (!fs.existsSync(serverEntryPath)) {
    throw new Error('MCP server entry does not exist; run `npm run build`');
  }
  if (!fs.statSync(serverEntryPath).isFile()) {
    throw new Error('MCP server entry must be a file');
  }
}
