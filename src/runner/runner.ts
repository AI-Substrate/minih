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
import { validateInput, validateOutput } from './validator.js';

/**
 * Resolve the preamble path for an agents directory.
 * Convention: <agentsDir>/_shared/preamble.md
 */
function resolvePreamblePath(agentsDir: string): string {
  return path.join(path.resolve(agentsDir), '_shared', 'preamble.md');
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

  // Create run folder with frozen copies
  const { runDir, runId } = createRunFolder(definition);
  const eventsPath = path.join(runDir, 'events.ndjson');

  fs.writeFileSync(eventsPath, '');

  const outputPath = path.join(runDir, 'output', 'report.json');
  const stderrPath = path.join(runDir, 'stderr.log');

  // Read prompt and strip frontmatter
  const rawPrompt = fs.readFileSync(definition.promptPath, 'utf-8');
  const { body: prompt } = parseFrontmatter(rawPrompt);

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

  // Validate and format input parameters
  let paramsHint: string | null = null;
  if (definition.inputSchemaPath) {
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

  // Build full prompt (preamble + instructions + output path hint + params + prompt)
  const outputHint = definition.schemaPath
    ? `Write your final JSON report to: ${outputPath}`
    : null;
  const fullPrompt = [preamble, instructions, outputHint, paramsHint, prompt]
    .filter(Boolean)
    .join('\n\n---\n\n');

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
      prompt: fullPrompt,
      model: config.model,
      reasoningEffort: config.reasoningEffort,
      cwd: config.cwd,
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

  // Validate output if schema exists
  let validation: ValidationResult | null = null;
  if (definition.schemaPath) {
    validation = validateOutput(definition.schemaPath, outputPath);
  }

  // Determine final result status
  let resultStatus: CompletedMetadata['result'] =
    agentResult.status === 'completed' ? 'completed' : 'failed';
  if (timedOut) resultStatus = 'timeout';
  if (agentResult.status === 'completed' && validation && !validation.valid)
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
    validated: validation ? validation.valid : null,
    validationErrors: validation?.errors ?? [],
    eventCount: stats.total,
    toolCallCount: stats.toolCalls,
    artifacts,
  };

  fs.writeFileSync(
    path.join(runDir, 'completed.json'),
    JSON.stringify(metadata, null, 2),
  );

  return { agentResult, metadata, validation, runDir };
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
