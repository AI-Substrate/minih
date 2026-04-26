import * as fs from 'node:fs';
import * as path from 'node:path';
import { MINIH_ENV_KEYS_COORDINATION } from '../runner/context.js';
import { validateSlug } from '../runner/folder.js';
import { McpToolError } from './types.js';

export const MCP_ENV_KEYS = {
  runId: 'MINIH_MCP_RUN_ID',
  runDir: 'MINIH_MCP_RUN_DIR',
  agentSlug: 'MINIH_MCP_AGENT_SLUG',
  agentsDir: 'MINIH_MCP_AGENTS_DIR',
  processMarker: 'MINIH_MCP_PROCESS_MARKER',
} as const;

export interface McpServerContext {
  context: 'inside';
  side: 'inside';
  runId: string;
  runDir: string;
  agentSlug: string;
  agentsDir: string;
  agentDir: string;
  inboxDir: string;
  stateDir: string;
  processMarker: string;
}

const REQUIRED_COORDINATION_KEYS = [
  'MINIH_INBOX_DIR',
  'MINIH_STATE_DIR',
  'MINIH_CONTEXT',
] as const;

const REQUIRED_MCP_KEYS = [
  MCP_ENV_KEYS.runId,
  MCP_ENV_KEYS.runDir,
  MCP_ENV_KEYS.agentSlug,
  MCP_ENV_KEYS.agentsDir,
  MCP_ENV_KEYS.processMarker,
] as const;

type Env = Record<string, string | undefined>;

export class McpContextError extends McpToolError {
  constructor(message: string) {
    super('MCP_CONTEXT_INVALID', message);
    this.name = 'McpContextError';
  }
}

export function loadMcpContext(env: Env = process.env): McpServerContext {
  for (const key of REQUIRED_COORDINATION_KEYS) requireEnv(env, key);
  for (const key of REQUIRED_MCP_KEYS) requireEnv(env, key);

  const context = env.MINIH_CONTEXT;
  if (context !== 'inside') {
    throw invalid('MCP coordination server must run with MINIH_CONTEXT=inside');
  }

  const agentSlug = requireEnv(env, MCP_ENV_KEYS.agentSlug);
  if (validateSlug(agentSlug) !== null) {
    throw invalid(`${MCP_ENV_KEYS.agentSlug} is invalid`);
  }

  const runId = requireEnv(env, MCP_ENV_KEYS.runId);
  const processMarker = requireEnv(env, MCP_ENV_KEYS.processMarker);
  if (processMarker !== `minih-mcp-${runId}`) {
    throw invalid(`${MCP_ENV_KEYS.processMarker} does not match run metadata`);
  }

  const agentsDir = canonicalPath(
    requireEnv(env, MCP_ENV_KEYS.agentsDir),
    MCP_ENV_KEYS.agentsDir,
  );
  const agentDir = canonicalChildPath(
    path.join(agentsDir, agentSlug),
    'agent directory',
  );
  assertContained(
    agentDir,
    agentsDir,
    'agent directory',
    MCP_ENV_KEYS.agentsDir,
  );

  const runDir = canonicalPath(
    requireEnv(env, MCP_ENV_KEYS.runDir),
    MCP_ENV_KEYS.runDir,
  );
  assertContained(
    runDir,
    path.join(agentDir, 'runs'),
    MCP_ENV_KEYS.runDir,
    'agent runs directory',
  );

  const inboxDir = canonicalPath(
    requireEnv(env, 'MINIH_INBOX_DIR'),
    'MINIH_INBOX_DIR',
  );
  assertExactPath(
    inboxDir,
    path.join(agentDir, 'inbox'),
    'MINIH_INBOX_DIR',
    'agent inbox directory',
  );

  const stateDir = canonicalPath(
    requireEnv(env, 'MINIH_STATE_DIR'),
    'MINIH_STATE_DIR',
  );
  assertExactPath(
    stateDir,
    path.join(agentDir, 'state'),
    'MINIH_STATE_DIR',
    'agent state directory',
  );

  return {
    context: 'inside',
    side: 'inside',
    runId,
    runDir,
    agentSlug,
    agentsDir,
    agentDir,
    inboxDir,
    stateDir,
    processMarker,
  };
}

export function coordinationEnvKeys(): readonly string[] {
  return MINIH_ENV_KEYS_COORDINATION;
}

function requireEnv(env: Env, key: string): string {
  const value = env[key];
  if (value === undefined || value === '') {
    throw invalid(`missing required MCP context env ${key}`);
  }
  return value;
}

function canonicalPath(rawPath: string, key: string): string {
  if (!path.isAbsolute(rawPath)) {
    throw invalid(`${key} must be an absolute path`);
  }
  return canonicalChildPath(path.resolve(rawPath), key);
}

function canonicalChildPath(absPath: string, key: string): string {
  const { existingAncestor, missingSegments } =
    nearestExistingAncestor(absPath);
  let realAncestor: string;
  try {
    realAncestor = fs.realpathSync(existingAncestor);
  } catch {
    throw invalid(`${key} cannot be resolved`);
  }

  const canonical = path.join(realAncestor, ...missingSegments);
  if (!fs.existsSync(canonical)) return canonical;

  try {
    return fs.realpathSync(canonical);
  } catch {
    throw invalid(`${key} cannot be resolved`);
  }
}

function nearestExistingAncestor(absPath: string): {
  existingAncestor: string;
  missingSegments: string[];
} {
  const missingSegments: string[] = [];
  let current = absPath;

  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) {
      throw invalid('MCP context path has no existing ancestor');
    }
    missingSegments.unshift(path.basename(current));
    current = parent;
  }

  return { existingAncestor: current, missingSegments };
}

function assertExactPath(
  actual: string,
  expectedRaw: string,
  actualLabel: string,
  expectedLabel: string,
): void {
  const expected = path.resolve(expectedRaw);
  if (actual !== expected) {
    throw invalid(`${actualLabel} must resolve to the ${expectedLabel}`);
  }
}

function assertContained(
  child: string,
  parentRaw: string,
  childLabel: string,
  parentLabel: string,
): void {
  const parent = canonicalChildPath(path.resolve(parentRaw), parentLabel);
  const relative = path.relative(parent, child);
  if (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  ) {
    return;
  }
  throw invalid(`${childLabel} must resolve inside ${parentLabel}`);
}

function invalid(message: string): McpContextError {
  return new McpContextError(`invalid MCP context: ${message}`);
}
