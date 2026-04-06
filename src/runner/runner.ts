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
import type { AgentEvent, AgentResult } from '../adapter/events.js';
import type { IAgentAdapter } from '../adapter/interface.js';
import { createRunFolder, parseFrontmatter } from './folder.js';
import type {
  AgentDefinition,
  AgentRunConfig,
  AgentRunResult,
  CompletedMetadata,
  RunEventStats,
  ValidationResult,
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
    "magicWand": "If you could change ONE thing about this experience to make your job easier, what would it be? Be concrete — name a specific tool, command, flag, or workflow improvement."
  }
}
\`\`\`

Your agent-specific output fields go alongside these system fields in the same JSON object.
The retrospective.magicWand is the most valuable thing you produce — it directly improves
this system for every agent that runs after you.

After writing your output, you can validate it by running: minih check`;

/** All MINIH_* env var keys set during a run. */
const MINIH_ENV_KEYS = [
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
    finalPrompt = [
      preamble,
      instructions,
      outputHint,
      paramsHint,
      prompt,
      SYSTEM_OUTPUT_INSTRUCTIONS,
    ]
      .filter(Boolean)
      .join('\n\n---\n\n');
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

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const runPromise = adapter.run({
      prompt: finalPrompt,
      sessionId: config.sessionId,
      model: config.model,
      reasoningEffort: config.reasoningEffort,
      cwd: runDir, // SDK isolated to run folder (Workshop 005)
      onEvent: handleEvent,
      timeout: timeoutMs,
    });
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
  }

  const completedAt = new Date();
  const durationMs = completedAt.getTime() - startedAt.getTime();

  // Write agent output as fallback (if agent didn't write via tool calls)
  if (agentResult.output && !fs.existsSync(outputPath)) {
    fs.writeFileSync(outputPath, agentResult.output);
  }

  // Persist stderr
  if (agentResult.stderr) {
    stderrLines.push(agentResult.stderr);
  }
  if (stderrLines.length > 0) {
    fs.writeFileSync(stderrPath, stderrLines.join('\n'));
  }

  // Two-stage validation: system fields first, then user schema
  // Skip system validation for resumed runs — no summary/retrospective required
  const systemValidation = isResume
    ? { valid: true, errors: [] }
    : validateSystemOutput(outputPath);
  let userValidation: ValidationResult | null = null;
  if (definition.schemaPath) {
    userValidation = validateOutput(definition.schemaPath, outputPath);
  }

  // Combined validation result
  const allErrors = [
    ...systemValidation.errors,
    ...(userValidation?.errors ?? []),
  ];
  const validated =
    systemValidation.valid && (userValidation ? userValidation.valid : true);

  // Determine final result status
  let resultStatus: CompletedMetadata['result'] =
    agentResult.status === 'completed' ? 'completed' : 'failed';
  if (timedOut) resultStatus = 'timeout';
  if (agentResult.status === 'completed' && !validated)
    resultStatus = 'degraded';

  const artifacts = listArtifacts(runDir);

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
  };

  fs.writeFileSync(
    path.join(runDir, 'completed.json'),
    JSON.stringify(metadata, null, 2),
  );

  // Clean up runtime environment (Workshop 007)
  for (const key of MINIH_ENV_KEYS) {
    delete process.env[key];
  }

  return { agentResult, metadata, validation: userValidation, runDir };
}

function listArtifacts(dir: string, base?: string): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
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
