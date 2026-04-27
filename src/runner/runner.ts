/**
 * Agent runner — pure orchestration function.
 *
 * Takes an IAgentAdapter (injected by CLI), an AgentDefinition,
 * and an AgentRunConfig. Executes the prompt, streams events to NDJSON,
 * writes completed.json, and returns structured results.
 *
 * Zero SDK imports — the runner is adapter-agnostic.
 *
 * Extracted from: harness/src/agent/runner.ts
 * Adapted: configurable preamble path, frontmatter stripping, no hardcoded root.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  AgentEvent,
  AgentResult,
  SessionSender,
} from '../adapter/events.js';
import type { IAgentAdapter } from '../adapter/interface.js';
import {
  coordinationRunLocation,
  createRunFolder,
  inboxLanePath,
  parseFrontmatter,
  stateFilePath,
} from './folder.js';
import {
  createInboxForwarder,
  type InboxForwarder,
} from './inbox-forwarder.js';
import { buildInsidePreamble } from './preamble-builder.js';
import { readStateLazy } from './state.js';
import {
  createStateForwarder,
  type StateForwarder,
} from './state-forwarder.js';
import type {
  AgentDefinition,
  AgentRunConfig,
  AgentRunResult,
  CompletedMetadata,
  ParsedReport,
  RunEventStats,
  ValidationResult,
  VelocityData,
} from './types.js';
import {
  validateInput,
  validateOutput,
  validateSystemOutput,
} from './validator.js';

/**
 * Resolve the preamble path for an agents directory.
 * Convention: <agentsDir>/_shared/preamble.md
 */
function resolvePreamblePath(agentsDir: string): string {
  return path.join(path.resolve(agentsDir), '_shared', 'preamble.md');
}

/** System output requirements injected into every agent prompt. */
export const SYSTEM_OUTPUT_INSTRUCTIONS = `## Required Output Format

Your output MUST be a valid JSON object written to the path specified above ($MINIH_OUTPUT_PATH).
At minimum, your JSON must include these fields:

\`\`\`json
{
  "summary": "A single paragraph describing what you did and what you found.",
  "retrospective": {
    "workedWell": "What about the tools, workflow, or environment was smooth? Be specific.",
    "confusing": "What was unclear, confusing, or required trial-and-error?",
    "magicWand": "If you could change ONE thing about this experience to make your job easier, what would it be? Be concrete — name a specific tool, command, flag, or workflow improvement.",
    "magicWandTarget": "project, minih, or coordination — which system does your magic wand target? 'coordination' = the outside/inside collaboration loop.",
    "coordination": {
      "peerUpdatesSent": 0,
      "unresolvedPeerRequests": 0,
      "statePublished": false,
      "notes": "Optional coordination-specific feedback."
    },
    "difficulties": [
      {
        "id": "MH-001",
        "category": "config",
        "description": "GH_TOKEN not set, no actionable error — just a cryptic 401",
        "workaround": "Guessed from SDK source that GH_TOKEN was needed",
        "severity": "blocking"
      }
    ]
  }
}
\`\`\`

### Magic Wand Target

Your magicWand should specify which layer it targets:
- **"project"** — the codebase, CLI tools, or developer experience you're testing/reviewing
- **"minih"** — the agent runner, validation, prompt assembly, or conventions
- **"coordination"** — the outside/inside inbox, state, MCP, and peer-contract workflow

If coordination affected your run, optionally add retrospective.coordination with:
peerUpdatesSent, unresolvedPeerRequests, statePublished, and notes.

### Reporting Difficulties

If you hit friction during this run — something that slowed you down, confused you, or
required a workaround — report it in retrospective.difficulties. Number each difficulty
yourself (MH-001, MH-002, etc.) within your run. Each difficulty needs:
- **id**: your self-assigned ID for this run (e.g., "MH-001")
- **category**: what kind of friction (suggested: build, config, data, test, debug, knowledge — or your own)
- **description**: what happened, specifically
- **workaround**: what you did to get past it (or null if you couldn't)
- **severity**: blocking (couldn't proceed), degrading (worked around it), or annoying (minor friction)

These reports feed the project's difficulty ledger. The calling agent or human maintains
the ledger — combining difficulties from minih agent runs with their own friction.

Your agent-specific output fields go alongside these system fields in the same JSON object.
The retrospective.magicWand is the most valuable thing you produce — it directly improves
this system for every agent that runs after you.

## MANDATORY: Validate Before Finishing

After writing your output, you MUST run \`minih check\` and verify it passes.
If validation fails, read the errors, fix your output, and re-run \`minih check\`.
Repeat until validation passes or you've exhausted reasonable attempts.

If you cannot make the output valid after 3 attempts, write a valid JSON object
explaining what went wrong:

\`\`\`json
{
  "summary": "Describe what you accomplished and why validation failed.",
  "validationAttempts": 3,
  "validationErrors": ["list the errors you could not resolve"],
  "retrospective": { "workedWell": "...", "confusing": "...", "magicWand": "..." }
}
\`\`\`

Do NOT finish without running \`minih check\` at least once.

## Cleanup

Before finishing, clean up any temporary artifacts you created during execution:
- Git worktrees (\`git worktree remove <path>\`)
- Temp directories (\`rm -rf /tmp/...\`)
- Scratch files outside the run folder
- Background processes you started

The run folder itself is managed by minih — don't delete it.

## Filing Issues for Critical Improvements

If you have \`gh\` CLI access and discovered a **bug or critical improvement** in minih
itself (not the project you're working on), file it:

\`\`\`bash
gh issue create --repo AI-Substrate/minih --title "bug: <title>" --body "<details>"
\`\`\`

Only file for blocking issues, crashes, or missing capabilities — not minor nits.
Your magicWand feedback is always captured; issues are for things that need immediate attention.`;

/**
 * All MINIH_* env var keys set during a run.
 *
 * Exported (P1 / Phase 007) so `context.ts` can compose `MINIH_ENV_KEYS_ALL`
 * for downstream consumers (P3 forwarders, P4 MCP spawn config).
 */
export const MINIH_ENV_KEYS = [
  'MINIH',
  'MINIH_AGENT_SLUG',
  'MINIH_RUN_ID',
  'MINIH_RUN_DIR',
  'MINIH_OUTPUT_PATH',
  'MINIH_AGENTS_DIR',
  'MINIH_PROJECT_ROOT',
  'MINIH_MODEL',
  'MINIH_TIMEOUT',
  'MINIH_SCHEMA_PATH',
  'MINIH_INSTRUCTIONS_PATH',
  'MINIH_PREAMBLE_PATH',
  'MINIH_HAS_INPUT_SCHEMA',
  'MINIH_PARAMS',
];

const MINIH_RUNTIME_ENV_KEYS = [
  ...MINIH_ENV_KEYS,
  'MINIH_CONTEXT',
  'MINIH_INBOX_DIR',
  'MINIH_STATE_DIR',
];

const TERMINAL_CONDITION_POLL_MS = 10;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for the runner-owned terminal condition after the adapter reaches idle.
 *
 * P2 uses a zero-count placeholder. P3 replaces that getter with a live view of
 * inbox/state forwarder queues without changing the runner/adapter contract.
 */
export async function awaitTerminalCondition(
  adapterResult: AgentResult,
  pendingForwarderCount: () => number,
): Promise<AgentResult> {
  while (pendingForwarderCount() > 0) {
    await wait(TERMINAL_CONDITION_POLL_MS);
  }
  return adapterResult;
}

/**
 * Execute an agent from its definition.
 *
 * @param adapter - The agent adapter (SdkCopilotAdapter in prod, FakeAgentAdapter in tests)
 * @param definition - The resolved agent definition (from folder.ts)
 * @param config - Run configuration (model, timeout, etc.)
 * @param onEvent - Optional callback for real-time event display
 * @param agentsDir - Agents directory (for preamble resolution)
 */
export async function runAgent(
  adapter: IAgentAdapter,
  definition: AgentDefinition,
  config: AgentRunConfig,
  onEvent?: (event: AgentEvent) => void,
  agentsDir?: string,
): Promise<AgentRunResult> {
  const startedAt = new Date();
  const isResume = !!config.sessionId;
  const coordinationEnabled = definition.coordination?.enabled === true;

  // Create run folder with frozen copies
  const { runDir, runId } = createRunFolder(definition);
  const eventsPath = path.join(runDir, 'events.ndjson');

  fs.writeFileSync(eventsPath, '');

  const outputPath = path.join(runDir, 'output', 'report.json');
  const stderrPath = path.join(runDir, 'stderr.log');

  // Read prompt and strip frontmatter (or use override for resume)
  const rawPrompt = fs.readFileSync(definition.promptPath, 'utf-8');
  const prompt = config.promptOverride ?? parseFrontmatter(rawPrompt).body;

  // Read instructions (optional)
  const instructions = definition.instructionsPath
    ? fs.readFileSync(definition.instructionsPath, 'utf-8')
    : null;

  // Shared preamble — injected for all agents with template variables replaced
  const repoRoot = config.cwd ?? process.cwd();
  let preamble: string | null = null;
  if (agentsDir) {
    const preamblePath = resolvePreamblePath(agentsDir);
    if (fs.existsSync(preamblePath)) {
      preamble = fs
        .readFileSync(preamblePath, 'utf-8')
        .replaceAll('{{REPO_ROOT}}', repoRoot);
    }
  }

  // Validate and format input parameters (skip for resume — SDK has prior context)
  let paramsHint: string | null = null;
  if (!isResume && definition.inputSchemaPath) {
    const params = config.params ?? {};
    const inputValidation = validateInput(definition.inputSchemaPath, params);
    if (!inputValidation.valid) {
      const errorMsg = `Input parameter validation failed:\n${inputValidation.errors.join('\n')}`;
      return {
        agentResult: {
          output: errorMsg,
          sessionId: '',
          status: 'failed',
          exitCode: 1,
          tokens: null,
        },
        metadata: {
          slug: definition.slug,
          runId,
          startedAt: startedAt.toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt.getTime(),
          sessionId: '',
          result: 'failed',
          exitCode: 1,
          validated: null,
          validationErrors: [],
          systemValidated: false,
          userValidated: null,
          eventCount: 0,
          toolCallCount: 0,
          artifacts: listArtifacts(runDir),
        },
        validation: null,
        runDir,
        parsedReport: null,
      };
    }
    if (Object.keys(params).length > 0) {
      const lines = Object.entries(params).map(([k, v]) => `${k}: ${v}`);
      paramsHint = `## Input Parameters\n\n${lines.join('\n')}`;
    }
  }

  // Build prompt: full assembly for fresh runs, just the message for resume
  let finalPrompt: string;

  if (isResume) {
    // Resume: send only the follow-up message — SDK has full conversation history
    finalPrompt = prompt;
  } else {
    // Fresh run: full prompt assembly (preamble + instructions + output hint + params + prompt + system requirements)
    const outputHint = `Write your final JSON report to: ${outputPath}`;
    finalPrompt = buildInsidePreamble({
      definition,
      runId,
      preamble,
      instructions,
      outputHint,
      paramsHint,
      userPrompt: prompt,
      systemOutputInstructions: SYSTEM_OUTPUT_INSTRUCTIONS,
    });
  }

  // Set runtime environment for the agent (Workshop 007)
  const resolvedAgentsDir = agentsDir ? path.resolve(agentsDir) : '';
  const preamblePath = agentsDir ? resolvePreamblePath(agentsDir) : '';
  process.env.MINIH = '1';
  process.env.MINIH_AGENT_SLUG = definition.slug;
  process.env.MINIH_RUN_ID = runId;
  process.env.MINIH_RUN_DIR = runDir;
  process.env.MINIH_OUTPUT_PATH = outputPath;
  process.env.MINIH_AGENTS_DIR = resolvedAgentsDir;
  process.env.MINIH_PROJECT_ROOT = config.cwd ?? process.cwd();
  process.env.MINIH_MODEL = config.model ?? '';
  process.env.MINIH_TIMEOUT = String(config.timeout ?? 300);
  process.env.MINIH_SCHEMA_PATH = definition.schemaPath ?? '';
  process.env.MINIH_INSTRUCTIONS_PATH = definition.instructionsPath ?? '';
  process.env.MINIH_PREAMBLE_PATH = fs.existsSync(preamblePath)
    ? preamblePath
    : '';
  process.env.MINIH_HAS_INPUT_SCHEMA = definition.inputSchemaPath
    ? 'true'
    : 'false';
  process.env.MINIH_PARAMS = JSON.stringify(config.params ?? {});
  if (coordinationEnabled && agentsDir) {
    const resolvedCoordinationAgentsDir = path.resolve(agentsDir);
    const coordinationLocation = coordinationRunLocation(
      definition.slug,
      resolvedCoordinationAgentsDir,
      runId,
    );
    process.env.MINIH_CONTEXT = 'inside';
    process.env.MINIH_INBOX_DIR = path.dirname(
      path.dirname(inboxLanePath(coordinationLocation, 'inside')),
    );
    process.env.MINIH_STATE_DIR = path.dirname(
      stateFilePath(coordinationLocation, 'inside'),
    );
  }

  // Event tracking
  const stats: RunEventStats = {
    total: 0,
    toolCalls: 0,
    toolResults: 0,
    messages: 0,
    thinking: 0,
    errors: 0,
  };
  let activeSessionId = '';
  const stderrLines: string[] = [];

  const handleEvent = (event: AgentEvent): void => {
    stats.total++;
    switch (event.type) {
      case 'tool_call':
        stats.toolCalls++;
        break;
      case 'tool_result':
        stats.toolResults++;
        break;
      case 'message':
        stats.messages++;
        break;
      case 'thinking':
        stats.thinking++;
        break;
      case 'session_error':
        stats.errors++;
        stderrLines.push(
          `[${event.timestamp}] ${event.data.errorType ?? 'ERROR'}: ${event.data.message ?? ''}`,
        );
        break;
      case 'session_start':
        if (event.data.sessionId) activeSessionId = event.data.sessionId;
        break;
    }

    // Write to NDJSON incrementally
    fs.appendFileSync(eventsPath, `${JSON.stringify(event)}\n`);

    if (onEvent) onEvent(event);
  };

  // Execute agent with timeout
  let agentResult: AgentResult;
  let timedOut = false;
  const timeoutMs = (config.timeout ?? 300) * 1000;

  let inboxForwarder: InboxForwarder | null = null;
  let stateForwarder: StateForwarder | null = null;
  const forwarderErrors: Error[] = [];
  const pendingForwarderCount = (): number =>
    (inboxForwarder?.pendingCount() ?? 0) +
    (stateForwarder?.pendingCount() ?? 0);
  const closeForwarders = (): void => {
    inboxForwarder?.close();
    stateForwarder?.close();
    inboxForwarder = null;
    stateForwarder = null;
  };
  const handleForwarderError = (error: Error): void => {
    forwarderErrors.push(error);
    closeForwarders();
  };
  const startForwarders = (sender: SessionSender): void => {
    if (!coordinationEnabled || !agentsDir) return;
    const forwarderOptions = {
      slug: definition.slug,
      agentsDir,
      runId,
      sender,
      commitProgress: 'manual' as const,
      onError: handleForwarderError,
    };
    inboxForwarder = createInboxForwarder(forwarderOptions);
    stateForwarder = createStateForwarder(forwarderOptions);
    void Promise.all([inboxForwarder.start(), stateForwarder.start()]).catch(
      (error: unknown) => {
        handleForwarderError(
          error instanceof Error ? error : new Error(String(error)),
        );
      },
    );
  };

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    // MCP config resolution:
    // - Explicit mcpServers (from --mcp-config): use directly
    // - Auto-discovery: check for .mcp.json at project root, load it ourselves
    //   (SDK discovers from workingDirectory which is the run folder, not project root)
    // - Always pass configDir for user-level config (~/.copilot/mcp-config)
    let mcpServers = config.mcpServers;
    if (!mcpServers) {
      const projectRoot = config.cwd ?? process.cwd();
      const mcpJsonPath = path.join(projectRoot, '.mcp.json');
      if (fs.existsSync(mcpJsonPath)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf-8'));
          if (parsed.mcpServers && typeof parsed.mcpServers === 'object') {
            mcpServers = parsed.mcpServers as Record<string, unknown>;
          }
        } catch {
          // Skip invalid .mcp.json — don't block the run
        }
      }
      // Set cwd on local MCP servers so they resolve relative paths from project root
      if (mcpServers) {
        const projectRoot = config.cwd ?? process.cwd();
        for (const server of Object.values(mcpServers)) {
          const s = server as Record<string, unknown>;
          if (!s.cwd && (!s.type || s.type === 'local' || s.type === 'stdio')) {
            s.cwd = projectRoot;
          }
        }
      }
    }
    const insideMcpServers =
      coordinationEnabled && agentsDir && config.insideMcpServerFactory
        ? config.insideMcpServerFactory({
            runId,
            runDir,
            agentSlug: definition.slug,
            agentsDir: path.resolve(agentsDir),
          })
        : undefined;
    mcpServers = mergeMcpServers(
      mcpServers,
      insideMcpServers,
      config.reservedMcpToolPrefixes ?? [],
    );

    const runPromise = adapter
      .run({
        prompt: finalPrompt,
        sessionId: config.sessionId,
        model: config.model,
        reasoningEffort: config.reasoningEffort,
        cwd: runDir, // SDK isolated to run folder (Workshop 005)
        onEvent: handleEvent,
        onSessionReady: startForwarders,
        configDir: config.configDir ?? config.cwd,
        ...(mcpServers && { mcpServers }),
      })
      .then(async (result) => {
        const terminal = await awaitTerminalCondition(
          result,
          pendingForwarderCount,
        );
        if (forwarderErrors.length > 0) throw forwarderErrors[0];
        if (terminal.status === 'completed') {
          inboxForwarder?.commit();
          stateForwarder?.commit();
        }
        return terminal;
      })
      .finally(closeForwarders);
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        reject(new Error(`Agent timed out after ${config.timeout ?? 300}s`));
      }, timeoutMs);
    });
    agentResult = await Promise.race([runPromise, timeoutPromise]);
  } catch (error) {
    if (timedOut) {
      try {
        await adapter.terminate(activeSessionId);
      } catch {
        /* best-effort */
      }
      agentResult = {
        output: `Agent timed out after ${config.timeout ?? 300}s`,
        sessionId: '',
        status: 'killed',
        exitCode: 124,
        tokens: null,
      };
    } else {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      agentResult = {
        output: `Agent execution failed: ${errorMessage}`,
        sessionId: '',
        status: 'failed',
        exitCode: 1,
        tokens: null,
      };
    }
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    closeForwarders();
  }

  const completedAt = new Date();
  const durationMs = completedAt.getTime() - startedAt.getTime();

  // Write agent output as fallback (only on completion). When the agent
  // failed before producing output, agentResult.output holds the SDK error
  // string — don't write it into output/report.json or downstream JSON
  // validation will report the misleading "Output is not valid JSON" noise.
  let agentSucceeded = agentResult.status === 'completed';
  if (agentSucceeded && agentResult.output && !fs.existsSync(outputPath)) {
    fs.writeFileSync(outputPath, agentResult.output);
  }

  if (agentSucceeded && coordinationEnabled && agentsDir) {
    try {
      snapshotCoordinationFiles(definition.slug, agentsDir, runId, runDir);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      agentResult = {
        output: `Run finalization failed: ${message}`,
        sessionId: agentResult.sessionId,
        status: 'failed',
        exitCode: 1,
        tokens: agentResult.tokens,
      };
      agentSucceeded = false;
    }
  }

  // Persist stderr
  if (agentResult.stderr) {
    stderrLines.push(agentResult.stderr);
  }
  if (!agentSucceeded && agentResult.output) {
    stderrLines.push(agentResult.output);
  }
  if (stderrLines.length > 0) {
    fs.writeFileSync(stderrPath, stderrLines.join('\n'));
  }

  // Two-stage validation: system fields first, then user schema.
  // Skip both when the agent failed (no output to validate) or when this is
  // a resume (no summary/retrospective contract on follow-ups).
  let systemValidation: ValidationResult;
  let userValidation: ValidationResult | null = null;
  if (!agentSucceeded) {
    systemValidation = { valid: false, errors: [] };
  } else if (isResume) {
    systemValidation = { valid: true, errors: [] };
  } else {
    systemValidation = validateSystemOutput(outputPath);
  }
  if (agentSucceeded && definition.schemaPath) {
    userValidation = validateOutput(definition.schemaPath, outputPath);
  }

  // Combined validation result
  const allErrors = [
    ...systemValidation.errors,
    ...(userValidation?.errors ?? []),
  ];
  const validated = !agentSucceeded
    ? null
    : systemValidation.valid && (userValidation ? userValidation.valid : true);

  // Determine final result status
  let resultStatus: CompletedMetadata['result'] = agentSucceeded
    ? 'completed'
    : 'failed';
  if (timedOut) resultStatus = 'timeout';
  if (agentSucceeded && validated === false) resultStatus = 'degraded';

  const artifacts = listArtifacts(runDir);

  // Compute velocity (skip for resumed runs — they share the original run's history)
  let velocity: VelocityData | undefined;
  if (!isResume && resultStatus === 'completed') {
    velocity = computeVelocity(durationMs, definition.dir, runId);
  }

  // Write completed.json
  const metadata: CompletedMetadata = {
    slug: definition.slug,
    runId,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs,
    sessionId: agentResult.sessionId,
    result: resultStatus,
    exitCode: agentResult.exitCode,
    validated,
    validationErrors: allErrors,
    systemValidated: systemValidation.valid,
    userValidated: userValidation ? userValidation.valid : null,
    eventCount: stats.total,
    toolCallCount: stats.toolCalls,
    artifacts,
    ...(config.resumedFromRunId && {
      resumedFromRunId: config.resumedFromRunId,
    }),
    ...(velocity && { velocity }),
  };

  fs.writeFileSync(
    path.join(runDir, 'completed.json'),
    JSON.stringify(metadata, null, 2),
  );

  // Parse report.json for envelope surfacing
  const parsedReport = parseReportJson(outputPath);

  // Clean up runtime environment (Workshop 007)
  for (const key of MINIH_RUNTIME_ENV_KEYS) {
    delete process.env[key];
  }

  return {
    agentResult,
    metadata,
    validation: userValidation,
    runDir,
    parsedReport,
  };
}

function mergeMcpServers(
  userServers: Record<string, unknown> | undefined,
  internalServers: Record<string, unknown> | undefined,
  reservedToolPrefixes: string[],
): Record<string, unknown> | undefined {
  if (!internalServers || Object.keys(internalServers).length === 0) {
    validateReservedMcpToolPrefixes(userServers, reservedToolPrefixes);
    return userServers;
  }

  for (const name of Object.keys(internalServers)) {
    if (userServers && Object.hasOwn(userServers, name)) {
      throw new Error(`MCP server name "${name}" is reserved by this run`);
    }
  }
  validateReservedMcpToolPrefixes(userServers, reservedToolPrefixes);
  return { ...(userServers ?? {}), ...internalServers };
}

function validateReservedMcpToolPrefixes(
  servers: Record<string, unknown> | undefined,
  reservedToolPrefixes: string[],
): void {
  if (!servers || reservedToolPrefixes.length === 0) return;
  for (const [serverName, server] of Object.entries(servers)) {
    if (
      typeof server !== 'object' ||
      server === null ||
      Array.isArray(server)
    ) {
      continue;
    }
    const tools = (server as Record<string, unknown>).tools;
    if (!Array.isArray(tools)) continue;
    for (const tool of tools) {
      if (typeof tool !== 'string') continue;
      const collidingPrefix = reservedToolPrefixes.find((prefix) =>
        tool.startsWith(prefix),
      );
      if (collidingPrefix) {
        throw new Error(
          `MCP server "${serverName}" declares reserved tool namespace "${collidingPrefix}*"`,
        );
      }
    }
  }
}

function listArtifacts(dir: string, base?: string): string[] {
  const files: string[] = [];
  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const rel = base ? path.join(base, entry.name) : entry.name;
    if (entry.isDirectory()) {
      files.push(...listArtifacts(path.join(dir, entry.name), rel));
    } else {
      files.push(rel);
    }
  }
  return files;
}

function snapshotCoordinationFiles(
  slug: string,
  agentsDir: string,
  runId: string,
  runDir: string,
): void {
  const resolvedAgentsDir = path.resolve(agentsDir);
  const location = coordinationRunLocation(slug, resolvedAgentsDir, runId);
  const inboxSnapshotDir = path.join(runDir, 'inbox-snapshot');
  fs.mkdirSync(inboxSnapshotDir, { recursive: true });

  for (const lane of ['outside', 'inside'] as const) {
    const source = inboxLanePath(location, lane);
    const target = path.join(inboxSnapshotDir, `${lane}.ndjson`);
    const content = fs.existsSync(source)
      ? fs.readFileSync(source, 'utf8')
      : '';
    fs.writeFileSync(target, content);
  }

  const outside = readPresentState(location, 'outside');
  const inside = readPresentState(location, 'inside');
  fs.writeFileSync(
    path.join(runDir, 'state-snapshot.json'),
    JSON.stringify({ outside, inside }, null, 2),
  );
}

function readPresentState(
  location: ReturnType<typeof coordinationRunLocation>,
  side: 'outside' | 'inside',
): ReturnType<typeof readStateLazy> | null {
  if (!fs.existsSync(stateFilePath(location, side))) return null;
  return readStateLazy(location, side);
}

/**
 * Compute velocity data by comparing this run against previous completed runs.
 * Chains from prior velocity blocks when available (O(1)).
 * Falls back to scanning run history for legacy runs without velocity data.
 */
export function computeVelocity(
  currentDurationMs: number,
  agentDir: string,
  currentRunId: string,
): VelocityData {
  const runsDir = path.join(agentDir, 'runs');
  if (!fs.existsSync(runsDir)) {
    return {
      previousDurationMs: null,
      changePercent: null,
      runNumber: 1,
      firstDurationMs: currentDurationMs,
      overallChangePercent: null,
    };
  }

  // Scan run folders in reverse chronological order (newest first)
  const entries = fs
    .readdirSync(runsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== currentRunId)
    .sort((a, b) => b.name.localeCompare(a.name));

  let previousCompleted: CompletedMetadata | null = null;
  let firstCompleted: CompletedMetadata | null = null;

  for (const entry of entries) {
    const completedPath = path.join(runsDir, entry.name, 'completed.json');
    try {
      if (!fs.existsSync(completedPath)) continue;
      const meta: CompletedMetadata = JSON.parse(
        fs.readFileSync(completedPath, 'utf-8'),
      );
      if (meta.result !== 'completed') continue;
      // Skip resumed runs — they don't represent independent work
      if (meta.resumedFromRunId) continue;

      if (!previousCompleted) {
        previousCompleted = meta;
        // If prior run has velocity, chain from it
        if (meta.velocity) {
          firstCompleted = {
            durationMs: meta.velocity.firstDurationMs ?? meta.durationMs,
          } as CompletedMetadata;
          break;
        }
      }

      // Legacy run without velocity — keep scanning for first
      firstCompleted = meta;
    } catch {
      // Skip corrupted completed.json
    }
  }

  if (!previousCompleted) {
    return {
      previousDurationMs: null,
      changePercent: null,
      runNumber: 1,
      firstDurationMs: currentDurationMs,
      overallChangePercent: null,
    };
  }

  const prevDuration = previousCompleted.durationMs;
  const changePercent =
    prevDuration > 0
      ? ((currentDurationMs - prevDuration) / prevDuration) * 100
      : null;

  const runNumber = previousCompleted.velocity
    ? previousCompleted.velocity.runNumber + 1
    : 2; // At minimum this is the 2nd completed run

  const firstDuration = firstCompleted
    ? (firstCompleted.velocity?.firstDurationMs ?? firstCompleted.durationMs)
    : prevDuration;

  const overallChangePercent =
    firstDuration > 0
      ? ((currentDurationMs - firstDuration) / firstDuration) * 100
      : null;

  return {
    previousDurationMs: prevDuration,
    changePercent:
      changePercent !== null ? Math.round(changePercent * 10) / 10 : null,
    runNumber,
    firstDurationMs: firstDuration,
    overallChangePercent:
      overallChangePercent !== null
        ? Math.round(overallChangePercent * 10) / 10
        : null,
  };
}

/**
 * Safely parse report.json and extract key retrospective fields.
 * Returns null on any failure — never throws.
 */
function parseReportJson(outputPath: string): ParsedReport | null {
  try {
    if (!fs.existsSync(outputPath)) return null;
    const content = fs.readFileSync(outputPath, 'utf-8').trim();
    if (!content) return null;
    const parsed = JSON.parse(content);
    if (typeof parsed !== 'object' || parsed === null) return null;

    const retro =
      typeof parsed.retrospective === 'object' && parsed.retrospective !== null
        ? parsed.retrospective
        : null;

    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary : null,
      magicWand:
        retro && typeof retro.magicWand === 'string' ? retro.magicWand : null,
      magicWandTarget:
        retro && typeof retro.magicWandTarget === 'string'
          ? retro.magicWandTarget
          : null,
      coordination:
        retro && isRetrospectiveCoordination(retro.coordination)
          ? retro.coordination
          : null,
      difficulties:
        retro && Array.isArray(retro.difficulties)
          ? retro.difficulties.filter(
              (d: unknown) =>
                typeof d === 'object' &&
                d !== null &&
                typeof (d as Record<string, unknown>).description === 'string',
            )
          : null,
    };
  } catch {
    return null;
  }
}

function isRetrospectiveCoordination(
  value: unknown,
): ParsedReport['coordination'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as ParsedReport['coordination'];
}
