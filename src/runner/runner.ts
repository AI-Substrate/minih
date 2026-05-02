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
import { context } from '@opentelemetry/api';
import { encode } from 'gpt-tokenizer';
import type { AgentEvent, AgentResult } from '../adapter/events.js';
import type { IAgentAdapter } from '../adapter/interface.js';
import {
  captureContext,
  createLogger,
  eventCount as eventMetric,
  promptTokens,
  runCount,
  runDuration,
  runInContext,
  setBaggage,
  toolCallCount as toolCallMetric,
  withSpan,
  withSpanSync,
} from '../telemetry/index.js';
import { createRunFolder, parseFrontmatter } from './folder.js';
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
    "magicWandTarget": "project or minih — which system does your magic wand target? 'project' = the codebase/tools you tested. 'minih' = the agent runner itself.",
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

  const log = createLogger('runner');

  // Set baggage for automatic propagation to all child spans (DD5)
  const baggageCtx = setBaggage({
    'minih.agent.slug': definition.slug,
    'minih.run_id': runId,
    ...(config.model ? { 'minih.model': config.model } : {}),
  });

  return context.with(baggageCtx, async () => {
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
            status: 'failed' as const,
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
            result: 'failed' as const,
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

    // ── Prompt Assembly Span ──
    const { finalPrompt, promptTokenCount } = withSpanSync(
      'minih.run.prompt_assembly',
      (assemblySpan) => {
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

        assemblySpan.setAttribute('prompt.chars', finalPrompt.length);
        assemblySpan.setAttribute('preamble.chars', preamble?.length ?? 0);
        assemblySpan.setAttribute(
          'instructions.chars',
          instructions?.length ?? 0,
        );
        assemblySpan.setAttribute('is_resume', isResume);
        log.debug('Prompt assembled', {
          'prompt.chars': finalPrompt.length,
          'preamble.chars': preamble?.length ?? 0,
          'instructions.chars': instructions?.length ?? 0,
        });

        return { finalPrompt, promptTokenCount: encode(finalPrompt).length };
      },
    ); // end prompt assembly span

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

    // Capture context for event handler propagation (Key Finding #02)
    const runContext = captureContext();

    const handleEvent = (event: AgentEvent): void => {
      // Restore context inside callback (context.with) for span correlation
      runInContext(runContext, () => {
        stats.total++;
        eventMetric.add(1, { 'agent.slug': definition.slug });
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
      }); // end runInContext
    };

    // Execute agent with timeout
    let agentResult: AgentResult;
    let timedOut = false;
    const timeoutMs = (config.timeout ?? 300) * 1000;

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    try {
      // ── Execution Span ──
      agentResult = await withSpan('minih.run.execution', async (execSpan) => {
        execSpan.setAttribute('agent.slug', definition.slug);
        execSpan.setAttribute('timeout_ms', timeoutMs);
        log.info(`Agent run started: ${definition.slug}`, {
          'agent.slug': definition.slug,
          model: config.model ?? '',
        });
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
              if (
                !s.cwd &&
                (!s.type || s.type === 'local' || s.type === 'stdio')
              ) {
                s.cwd = projectRoot;
              }
            }
          }
        }

        const runPromise = adapter.run({
          prompt: finalPrompt,
          sessionId: config.sessionId,
          model: config.model,
          reasoningEffort: config.reasoningEffort,
          cwd: runDir, // SDK isolated to run folder (Workshop 005)
          onEvent: handleEvent,
          timeout: timeoutMs,
          configDir: config.configDir ?? config.cwd,
          ...(mcpServers && { mcpServers }),
        });
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            timedOut = true;
            reject(
              new Error(`Agent timed out after ${config.timeout ?? 300}s`),
            );
          }, timeoutMs);
        });
        const result = await Promise.race([runPromise, timeoutPromise]);
        execSpan.setAttribute('session.id', result.sessionId);
        execSpan.setAttribute('status', result.status);
        return result;
      }); // end execution span
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

    // ── Validation Span ──
    const { systemValidation, userValidation, allErrors, validated } =
      withSpanSync('minih.run.validation', (valSpan) => {
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
          systemValidation.valid &&
          (userValidation ? userValidation.valid : true);

        valSpan.setAttribute('valid', validated);
        valSpan.setAttribute('error.count', allErrors.length);
        valSpan.setAttribute('system.valid', systemValidation.valid);
        if (userValidation)
          valSpan.setAttribute('user.valid', userValidation.valid);

        if (!validated) {
          log.warn('Output validation failed', {
            'error.count': allErrors.length,
            'agent.slug': definition.slug,
          });
        }

        return { systemValidation, userValidation, allErrors, validated };
      }); // end validation span

    // Determine final result status
    let resultStatus: CompletedMetadata['result'] =
      agentResult.status === 'completed' ? 'completed' : 'failed';
    if (timedOut) resultStatus = 'timeout';
    if (agentResult.status === 'completed' && !validated)
      resultStatus = 'degraded';

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
    for (const key of MINIH_ENV_KEYS) {
      delete process.env[key];
    }

    // ── Record Metrics ──
    const metricAttrs = { 'agent.slug': definition.slug, result: resultStatus };
    runDuration.record(durationMs, metricAttrs);
    runCount.add(1, metricAttrs);
    toolCallMetric.record(stats.toolCalls, metricAttrs);
    promptTokens.record(promptTokenCount, { 'agent.slug': definition.slug });

    log.info(`Agent run completed: ${definition.slug}`, {
      'agent.slug': definition.slug,
      duration_ms: durationMs,
      result: resultStatus,
      'event.count': stats.total,
      'tool_call.count': stats.toolCalls,
    });

    return {
      agentResult,
      metadata,
      validation: userValidation,
      runDir,
      parsedReport,
    };
  }); // end context.with (baggage)
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
