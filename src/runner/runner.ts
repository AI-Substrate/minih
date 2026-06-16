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
import { withDeadline } from '../adapter/deadline.js';
import type {
  AgentEvent,
  AgentResult,
  SessionSender,
} from '../adapter/events.js';
import type { IAgentAdapter } from '../adapter/interface.js';
import {
  drainAndReadInbox,
  reconcileReportFindings,
} from './coordination-drain.js';
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
import {
  assertCoordWriteAllowed,
  buildPermissionHandler,
  CoordinationWriteDeniedError,
  compile as compilePermissionPolicy,
  type DenialState,
  fireTerminalDenial,
  minihReleaseDefault,
  type PermissionPolicy,
  type ResolvedPolicy,
  resolveDefaultAllowedRoots,
} from './permissions/index.js';
import { buildInsidePreamble } from './preamble-builder.js';
import {
  appendRetroEntry,
  appendRetroStub,
  type RetroResult,
  type RetrospectiveLike,
} from './retro-ledger.js';
import {
  flushThrottled as flushManifestThrottled,
  updateManifest,
  writeManifest,
} from './run-manifest.js';
import { readStateLazy } from './state.js';
import {
  createStateForwarder,
  type StateForwarder,
} from './state-forwarder.js';
import {
  type AgentDefinition,
  type AgentRunConfig,
  type AgentRunResult,
  type CompletedMetadata,
  DEFAULT_IDLE_BUDGET_MS,
  DEFAULT_STALL_TIMEOUT_SEC,
  DEFAULT_TIMEOUT_SEC,
  type LiveRunManifest,
  type ParsedReport,
  type RunEventStats,
  type ValidationResult,
  type VelocityData,
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

/**
 * Plan 011 / Workshop 002 — auto-harvest helpers.
 *
 * Each call wraps a `retro-ledger` write in:
 *   - `MINIH_NO_AUTO_HARVEST=1` opt-out check (skip silently if set)
 *   - try/catch with debug stderr line on error (never throws back to runner)
 *
 * `runHarvested` is a function-local boolean threaded through runAgent's
 * crash-safety try/finally: success/stub paths set it true; the finally
 * block writes a `crashed` stub if it's still false (guards against
 * uncaught exceptions emitting nothing).
 */
interface HarvestContext {
  slug: string;
  runId: string;
  runDir: string;
  ledgerDir: string;
  planId: string | null;
  /** True when cwd has agents/ — guards against ad-hoc test invocations polluting unrelated projects. */
  isMinihProject: boolean;
  /** Mutated by the helpers below — the finally hook checks this. */
  done: { value: boolean };
}

function buildLedgerDir(cwd: string | undefined): string {
  return path.join(cwd ?? process.cwd(), 'docs', 'retros');
}

/**
 * Detect whether the cwd looks like a minih project root.
 *
 * Conservative heuristic — auto-harvest only fires when:
 *   1. `config.cwd` is EXPLICITLY set (not defaulted), AND
 *   2. that path contains an `agents/` directory.
 *
 * The CLI always passes an explicit cwd (see commands/run.ts and
 * commands/resume.ts). Tests that skip cwd default to undefined and so
 * skip auto-harvest cleanly. This guards against test/library invocations
 * polluting unrelated projects.
 */
function looksLikeMinihProject(cwd: string | undefined): boolean {
  if (!cwd) return false;
  const target = path.join(cwd, 'agents');
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

async function tryAutoHarvestRetro(
  ctx: HarvestContext,
  retrospective: RetrospectiveLike,
): Promise<void> {
  if (process.env.MINIH_NO_AUTO_HARVEST === '1') return;
  if (ctx.done.value) return;
  if (!ctx.isMinihProject) return; // non-project cwd — skip silently
  try {
    await appendRetroEntry({
      slug: ctx.slug,
      runId: ctx.runId,
      runDir: ctx.runDir,
      retrospective,
      planId: ctx.planId ?? undefined,
      ledgerDir: ctx.ledgerDir,
    });
    ctx.done.value = true;
  } catch (err) {
    process.stderr.write(
      `MINIH_AUTO_HARVEST_SKIPPED: ${(err as Error).message}\n`,
    );
  }
}

async function tryAutoHarvestStub(
  ctx: HarvestContext,
  result: RetroResult,
  stderrTail: string,
): Promise<void> {
  if (process.env.MINIH_NO_AUTO_HARVEST === '1') return;
  if (ctx.done.value) return;
  if (!ctx.isMinihProject) return;
  try {
    await appendRetroStub({
      slug: ctx.slug,
      runId: ctx.runId,
      runDir: ctx.runDir,
      result,
      stderrTail,
      planId: ctx.planId ?? undefined,
      ledgerDir: ctx.ledgerDir,
    });
    ctx.done.value = true;
  } catch (err) {
    process.stderr.write(
      `MINIH_AUTO_HARVEST_SKIPPED: ${(err as Error).message}\n`,
    );
  }
}

/** System output requirements injected into every agent prompt. */
export const SYSTEM_OUTPUT_INSTRUCTIONS = `## Required Output Format

Your output MUST be a valid JSON object written to the literal path specified above.
The runner also exposes that path as MINIH_OUTPUT_PATH where the execution environment supports it; if a shell cannot see that variable, use the literal path from this prompt.
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

After writing your output, you MUST run \`minih check\` and verify it passes. If MINIH_OUTPUT_PATH is unavailable in your shell, run \`minih check <slug> --file <literal-output-path>\` instead.
If validation fails, read the errors, fix your output, and re-run the same check command.
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

Do NOT finish without running \`minih check\` or \`minih check <slug> --file <literal-output-path>\` at least once.

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
  const isResumeInPlace = !!config.resumeInPlace;
  const coordinationEnabled = definition.coordination?.enabled === true;

  // Plan 011 HF-C: capture MINIH_PLAN_ID at entry (before any env scrubbing).
  // Threaded into auto-harvest writer for per-plan dual-write ledger.
  // Intentionally NOT added to MINIH_ENV_KEYS — that list drives the runtime
  // cleanup loop which would `delete process.env[key]` and lose the value.
  const planId: string | null = process.env.MINIH_PLAN_ID ?? null;

  // Resolve runDir/runId — either reuse the original (resume-in-place) or
  // allocate a fresh folder. Fail fast if resume-in-place is requested but
  // the prerequisite inputs are missing/invalid.
  let runDir: string;
  let runId: string;
  if (isResumeInPlace) {
    if (!config.resumedFromRunId) {
      throw new Error(
        'resumeInPlace=true requires resumedFromRunId pointing at the original run',
      );
    }
    const resolvedAgentsDir = agentsDir
      ? path.resolve(agentsDir)
      : path.resolve('agents');
    runId = config.resumedFromRunId;
    runDir = path.join(resolvedAgentsDir, definition.slug, 'runs', runId);
    if (!fs.existsSync(runDir)) {
      throw new Error(
        `resumeInPlace requires existing run dir; not found at ${runDir}`,
      );
    }
  } else {
    const created = createRunFolder(definition);
    runDir = created.runDir;
    runId = created.runId;
  }
  const eventsPath = path.join(runDir, 'events.ndjson');

  // Plan 011 / Workshop 002 — auto-harvest context. Threaded through every
  // terminal site below; the surrounding try/finally guarantees a stub
  // emission on crash if no entry was written.
  const harvestCtx: HarvestContext = {
    slug: definition.slug,
    runId,
    runDir,
    ledgerDir: buildLedgerDir(config.cwd),
    planId,
    isMinihProject: looksLikeMinihProject(config.cwd),
    done: { value: false },
  };

  try {
    if (isResumeInPlace) {
      // Append a synthetic resume marker so downstream tooling can see the
      // session boundary in the event stream.
      const marker = {
        type: 'resume',
        ts: startedAt.toISOString(),
        fromState: config.resumeFromState ?? null,
        kind: config.resumeKind ?? 'completed-followup',
        previousPid: config.resumePreviousPid ?? null,
      };
      fs.appendFileSync(eventsPath, `${JSON.stringify(marker)}\n`);
    } else {
      fs.writeFileSync(eventsPath, '');
    }

    // Plan 026 — effective run budgets, recorded in run.json at start so
    // operators can see what limits a run was under (AC-6). Also the single
    // computation the watchdog/timeout race arms read from.
    const budgets = {
      timeoutSec: config.timeout ?? DEFAULT_TIMEOUT_SEC,
      stallTimeoutSec: config.stallTimeout ?? DEFAULT_STALL_TIMEOUT_SEC,
      maxTurns: config.maxTurns ?? 0,
      // Plan 027 Phase 5 (#35) — record the effective idle budget for coordination
      // runs so `coordination_status` can surface `idleBudgetSec` (AC-12). The
      // companion reads its budget off disk via the tool, NOT from MINIH_PARAMS
      // (which never reaches the inside-MCP subprocess — PIC-P5-E / A2).
      ...(coordinationEnabled && {
        idleBudgetMs:
          typeof config.params?.idleBudgetMs === 'number'
            ? config.params.idleBudgetMs
            : DEFAULT_IDLE_BUDGET_MS,
      }),
    };

    // Initial run.json manifest — workshop 002 §1, plan 009.
    // Written immediately after run-folder creation so attach commands can
    // resolve the run by ID before session_start.
    const initialManifest: LiveRunManifest = {
      schemaVersion: 1,
      slug: definition.slug,
      runId,
      runDir,
      pid: process.pid,
      startedAt: startedAt.toISOString(),
      updatedAt: startedAt.toISOString(),
      status: 'starting',
      sessionId: null,
      model: config.model ?? null,
      control: { available: coordinationEnabled, kind: 'none' },
      ...(config.label && { label: config.label }),
      ...(config.paramsSummary && { paramsSummary: config.paramsSummary }),
      counters: { events: 0, toolCalls: 0, messages: 0, errors: 0 },
      budgets,
    };
    if (isResumeInPlace) {
      // Resume-in-place: mutate the existing run.json instead of overwriting it.
      // Workshop 001 § Manifest Evolution defines this contract.
      //
      // Write order (crash-recovery): rename completed.json BEFORE rewriting
      // run.json, so a crash mid-resume leaves run.json on the prior status
      // (detectRunState returns "stale") and a harmless completed-N.json artifact.
      const existing = JSON.parse(
        fs.readFileSync(path.join(runDir, 'run.json'), 'utf8'),
      );
      const priorResumes = Array.isArray(existing.resumes)
        ? existing.resumes
        : [];
      const completedPath = path.join(runDir, 'completed.json');
      if (fs.existsSync(completedPath)) {
        const archiveIndex = priorResumes.length + 1;
        fs.renameSync(
          completedPath,
          path.join(runDir, `completed-${archiveIndex}.json`),
        );
      }
      const resumeEntry: Record<string, unknown> = {
        ts: startedAt.toISOString(),
        kind: config.resumeKind ?? 'completed-followup',
      };
      if (config.resumeFromState)
        resumeEntry.fromState = config.resumeFromState;
      if (typeof config.resumePreviousPid === 'number') {
        resumeEntry.previousPid = config.resumePreviousPid;
      }
      const updated = {
        ...existing,
        schemaVersion: 1,
        pid: process.pid,
        status: 'starting',
        updatedAt: startedAt.toISOString(),
        resumes: [...priorResumes, resumeEntry],
        // Plan 026 — a resume may carry different budgets; record the
        // effective ones for this takeover/follow-up.
        budgets,
      };
      fs.writeFileSync(
        path.join(runDir, 'run.json'),
        `${JSON.stringify(updated, null, 2)}\n`,
      );
    } else {
      await writeManifest(runDir, initialManifest);
    }

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
        // Finalize manifest so this dead run never looks active to resolveRun().
        await updateManifest(runDir, { status: 'failed' });
        // Plan 011 — emit a stub so operators see this terminal failure in the ledger.
        await tryAutoHarvestStub(
          harvestCtx,
          'failed',
          errorMsg.split('\n')[0] ?? '',
        );
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
            ...(config.label && { label: config.label }),
            ...(config.paramsSummary && {
              paramsSummary: config.paramsSummary,
            }),
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
    // The project root is the resolved git root, NOT config.cwd: a spawned
    // companion's cwd IS its run dir, so config.cwd would point the child at
    // its own run folder. resolveDefaultAllowedRoots walks up to .git and
    // realpaths it (cwd-fallback when there is no repo). Informational only —
    // fs-guard permission boundaries are derived separately (defect E).
    process.env.MINIH_PROJECT_ROOT = resolveDefaultAllowedRoots(
      config.cwd ?? process.cwd(),
    ).roots[0];
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

    // Plan 018 R1 — compile permissions policy. Resolution chain per AC24:
    // frontmatter → sidecar lockedDefault → env → release default constant.
    //
    // Since Plan 018 R6 the release default is `restricted` (write-deny),
    // not `yolo` (see presets.ts `minihReleaseDefault`). Grandfathered
    // installs keep `yolo` via a sticky sidecar `lockedDefault`; a *new*
    // agent without explicit `permissions:` resolves to `restricted` here.
    // A runtime permission handler is built for any non-yolo policy
    // (`isNonDefaultPolicy`); only pure-yolo agents fall through to the
    // adapter's built-in `approveAll`. For coordination-enabled agents a
    // write-deny resolution trips the FX008 boot gate (E205) just below.
    const sidecarPolicy = readSidecarPermissions(definition.dir);
    const envPolicy = readEnvPermissions();
    // Plan 018 R2 + companion F005 — CLI `--permissions <preset>` overrides
    // ONLY the preset layer. The frontmatter's `overrides` and `allowedRoots`
    // survive (they encode agent-author intent that the per-run flag
    // shouldn't silently discard).
    const cliPresetOverride: PermissionPolicy | undefined = config
      .permissionsOverride?.preset
      ? definition.permissions
        ? {
            ...definition.permissions,
            preset: config.permissionsOverride.preset,
          }
        : { preset: config.permissionsOverride.preset }
      : undefined;
    const resolvedPolicy: ResolvedPolicy = compilePermissionPolicy({
      frontmatter: cliPresetOverride ?? definition.permissions,
      sidecar: sidecarPolicy,
      env: envPolicy,
      releaseDefault: { preset: minihReleaseDefault },
      cli: config.permissionsOverride?.allowedRoots,
      cwd: config.cwd ?? process.cwd(),
    });
    if (config.permissionsOverride?.strictFs) {
      resolvedPolicy.strictFs = true;
    }

    // Plan 018 AC1 + companion F002 — record resolved permissions in run.json
    // immediately after compile.
    await updateManifest(runDir, {
      permissions: {
        preset: resolvedPolicy.presetName,
        presetSource: resolvedPolicy.presetSource,
        canonicalRoots: resolvedPolicy.canonicalRoots,
        decisions: resolvedPolicy.decisions as unknown as Record<
          string,
          string
        >,
        ...(resolvedPolicy.mcpAllowedServers !== undefined && {
          mcpAllowedServers: resolvedPolicy.mcpAllowedServers,
        }),
        ...(resolvedPolicy.customToolAllowedNames !== undefined && {
          customToolAllowedNames: resolvedPolicy.customToolAllowedNames,
        }),
        ...(resolvedPolicy.strictFs && { strictFs: true }),
      },
    });

    // Denial state — closure shared with handler `onDeny` callback. The
    // `terminalFired` mutex enforces first-trigger-wins per workshop 002.
    const denialState: DenialState = {
      terminalFired: false,
      exitCode: 0,
      reason: null,
      payload: null,
      signalFailures: [],
    };

    // FX008-3 — boot precondition for coord-enabled + write-deny mismatch.
    // Coordinated agents are contractually required to write
    // `output/report.json` on exit (workshop 002 § Q1, companion-mode.md).
    // If the resolved policy denies write, refuse the run synchronously
    // BEFORE any SDK adapter session is opened. Routes through the existing
    // 5-signal denial protocol (events.ndjson + run.json + inside-state +
    // outside-inbox + exit 126).
    try {
      assertCoordWriteAllowed(definition, resolvedPolicy, {
        ...(config.permissionsOverride?.allowCoordWriteDeny !== undefined && {
          allowCoordWriteDeny: config.permissionsOverride.allowCoordWriteDeny,
        }),
        runDir,
      });
    } catch (err) {
      if (err instanceof CoordinationWriteDeniedError) {
        // Signal 1 — events.ndjson. Synthesise the `permission_denied` event
        // ourselves because the SDK adapter never starts; events.ndjson
        // would otherwise have no record of the denial.
        //
        // F004 (HIGH companion finding 2026-05-04): events.ndjson + run.json
        // are MANDATORY signals per workshop 002 § Q1. If these writes fail,
        // record the failure in `denialState.signalFailures` so it surfaces
        // in run.json `coordinationSignals` rather than silently re-creating
        // the observability hole FX008 was designed to close.
        const occurredAt = new Date().toISOString();
        const denialEvent = {
          type: 'permission_denied' as const,
          timestamp: occurredAt,
          data: {
            kind: err.kind,
            decision: 'deny' as const,
            message: err.message,
          },
        };
        try {
          fs.appendFileSync(eventsPath, `${JSON.stringify(denialEvent)}\n`);
        } catch (appendErr) {
          denialState.signalFailures.push({
            signal: 'events.ndjson',
            error: (appendErr as Error).message ?? String(appendErr),
          });
        }

        // Signals 3-4 — inside-state + outside-inbox. Reuses the existing
        // 5-signal machinery (`fireTerminalDenial`) so observers that
        // subscribe to those surfaces see this denial identically to a
        // mid-run handler-fired one.
        fireTerminalDenial(denialState, {
          runDir,
          runId,
          agentSlug: definition.slug,
          agentsDir,
          coordinationEnabled,
          policy: resolvedPolicy,
          reason: {
            kind: err.kind,
            decision: 'deny',
            message: err.message,
          },
          signalFailures: denialState.signalFailures,
        });

        // Signal 2 — run.json `terminalReason` + `permissionError` snapshot.
        // Mirrors the post-run write at line ~948 below for handler-fired
        // denials. Uses `denialState.payload` populated by
        // `fireTerminalDenial`.
        //
        // F004 — record write failures rather than swallow them. run.json
        // is mandatory; a swallowed failure produces an envelope-shaped
        // success even though the canonical record is incomplete.
        if (denialState.payload) {
          try {
            await updateManifest(runDir, {
              status: 'failed',
              terminalReason: denialState.reason ?? 'permission-denied',
              permissionError: {
                kind: denialState.payload.kind,
                decision: denialState.payload.decision,
                occurredAt: denialState.payload.occurredAt,
                message: denialState.payload.message,
                ...(denialState.payload.toolName !== undefined && {
                  toolName: denialState.payload.toolName,
                }),
                ...(denialState.payload.attemptedPath !== undefined && {
                  attemptedPath: denialState.payload.attemptedPath,
                }),
                ...(denialState.payload.requestId !== undefined && {
                  requestId: denialState.payload.requestId,
                }),
                ...(denialState.payload.toolCallId !== undefined && {
                  toolCallId: denialState.payload.toolCallId,
                }),
                ...(denialState.payload.policyDigest !== undefined && {
                  policyDigest: denialState.payload.policyDigest,
                }),
              },
              ...(denialState.signalFailures.length > 0 && {
                coordinationSignals: denialState.signalFailures,
              }),
            });
          } catch (manifestErr) {
            denialState.signalFailures.push({
              signal: 'run.json',
              error: (manifestErr as Error).message ?? String(manifestErr),
            });
            // Best-effort second write — try to persist at least the signal
            // failure so post-mortem investigators see something.
            try {
              await updateManifest(runDir, {
                status: 'failed',
                terminalReason: 'permission-denied',
                coordinationSignals: denialState.signalFailures,
              });
            } catch {
              // If even this minimal write fails, fall through — the early
              // exit will still return a failed AgentResult with exit 126,
              // and the caller (CLI) will surface E205 from the in-memory
              // err.message even when the on-disk canonical record is empty.
            }
          }
        }

        // Signal 5 — exit code 126 (POSIX permission-denied). Surfaced via
        // AgentResult.exitCode; the CLI consumer maps it to process exit.
        const completedAt = new Date();
        const earlyExitMetadata: CompletedMetadata = {
          slug: definition.slug,
          runId,
          startedAt: startedAt.toISOString(),
          completedAt: completedAt.toISOString(),
          durationMs: completedAt.getTime() - startedAt.getTime(),
          sessionId: '',
          result: 'failed',
          exitCode: 126,
          validated: false,
          validationErrors: [],
          systemValidated: false,
          userValidated: null,
          eventCount: 1,
          toolCallCount: 0,
          artifacts: [],
          ...(config.label && { label: config.label }),
          ...(config.paramsSummary && { paramsSummary: config.paramsSummary }),
          // FX008-4 — surface the denial reason so the CLI can route to
          // ErrorCodes.COORDINATION_WRITE_DENIED (E205) instead of generic
          // AGENT_EXECUTION_FAILED (E120).
          permissionError: {
            kind: err.kind,
            decision: 'deny',
            message: err.message,
          },
        };
        try {
          fs.writeFileSync(
            path.join(runDir, 'completed.json'),
            JSON.stringify(earlyExitMetadata, null, 2),
          );
        } catch (writeErr) {
          // completed.json is a runner artifact (not in workshop 002 § Q1's
          // mandatory signal set) — surface failure on stderr so post-mortem
          // tools (`minih history`, `minih retros`) showing this run as
          // "incomplete" forever has a visible cause, rather than silently
          // looking like a crash.
          process.stderr.write(
            `[minih] Warning: failed to write completed.json for permission-denied early exit: ${(writeErr as Error).message}\n`,
          );
        }

        // Mark auto-harvest as done so the `finally` block doesn't write a
        // second `crashed` stub on top of our explicit denial record.
        harvestCtx.done.value = true;

        // Clean up runtime environment (Workshop 007) — same as the normal
        // exit path so a second run in the same process doesn't see stale
        // env vars.
        for (const key of MINIH_RUNTIME_ENV_KEYS) {
          delete process.env[key];
        }

        return {
          agentResult: {
            output: err.message,
            sessionId: '',
            status: 'failed',
            exitCode: 126,
            tokens: null,
          },
          metadata: earlyExitMetadata,
          validation: null,
          runDir,
          parsedReport: null,
        };
      }
      // Unknown error — re-throw so the caller's normal error path handles it.
      throw err;
    }

    const permissionHandler = isNonDefaultPolicy(resolvedPolicy)
      ? buildPermissionHandler(resolvedPolicy, {
          onDeny: (reason) => {
            fireTerminalDenial(denialState, {
              runDir,
              runId,
              agentSlug: definition.slug,
              agentsDir,
              coordinationEnabled,
              policy: resolvedPolicy,
              reason,
              signalFailures: denialState.signalFailures,
            });
          },
        })
      : undefined;

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
    let timedOut = false;
    // Plan 025 FX012 — set when the adapter reports an aborted stream;
    // persisted to run.json post-run (mirrors the denial flow below).
    let streamAborted = false;
    // Plan 026 — single default source (CD-05); the message and the race
    // arm must always report the same configured value (`budgets` above).
    const timeoutSec = budgets.timeoutSec;
    const timeoutMs = timeoutSec * 1000;
    // Plan 026 — bound on the runner's own cleanup awaits after a kill
    // trigger; terminal writes must never wait on a wedged adapter.
    const cleanupGraceMs = config.cleanupGraceMs ?? 10_000;
    // Plan 026 (CD-02) — inactivity watchdog: a stream that silently stops
    // advancing (#44) settles neither session.idle nor session.error, so a
    // third race arm fires when no provider event arrives within the stall
    // budget. `stalled` mirrors `timedOut` everywhere. 0 disables.
    let stalled = false;
    let lastEventAt: string | undefined;
    let stallHandle: ReturnType<typeof setTimeout> | undefined;
    let fireStall: (() => void) | undefined;
    const stallTimeoutSec = budgets.stallTimeoutSec;
    const stallTimeoutMs = stallTimeoutSec * 1000;
    // Plan 026 (CD-03) — turn budget: one turn = one consolidated assistant
    // message (chunking-independent; tool/thinking events never count).
    // 0/unset = unlimited. `turnsExceeded` mirrors `timedOut`/`stalled`.
    let turnsExceeded = false;
    let fireMaxTurns: (() => void) | undefined;
    const maxTurns = budgets.maxTurns;
    const budgetBreached = (): boolean => timedOut || stalled || turnsExceeded;
    const budgetMessages: Record<
      'timeout' | 'stalled-stream' | 'max-turns',
      string
    > = {
      timeout: `Agent timed out after ${timeoutSec}s`,
      'stalled-stream': `Agent stalled: no provider events for ${stallTimeoutSec}s`,
      'max-turns': `Agent exceeded max-turns budget (${maxTurns})`,
    };
    const resetStallDeadline = (): void => {
      if (stallTimeoutMs <= 0 || budgetBreached()) return;
      lastEventAt = new Date().toISOString();
      if (stallHandle) clearTimeout(stallHandle);
      stallHandle = setTimeout(() => {
        fireStall?.();
      }, stallTimeoutMs);
    };
    const manifestUpdates = new Set<Promise<void>>();
    let manifestUpdateError: Error | null = null;

    const trackManifestUpdate = (update: Promise<void>): void => {
      const tracked = update.catch((err: unknown) => {
        manifestUpdateError =
          manifestUpdateError ??
          (err instanceof Error ? err : new Error(String(err)));
      });
      manifestUpdates.add(tracked);
      void tracked.finally(() => {
        manifestUpdates.delete(tracked);
      });
    };

    const drainTrackedManifestUpdates = async (): Promise<void> => {
      while (manifestUpdates.size > 0) {
        await Promise.all([...manifestUpdates]);
      }
      if (manifestUpdateError) {
        const error = manifestUpdateError;
        manifestUpdateError = null;
        throw error;
      }
    };

    const handleEvent = (event: AgentEvent): void => {
      if (budgetBreached()) return;

      // Plan 026 — ANY provider event proves the stream is advancing.
      // (The synthetic run_stalled event never passes through here — it
      // is emitted from the race arm — so it cannot reset the deadline.)
      resetStallDeadline();

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
          // Plan 026 (CD-03) — breach check at the turn-count increment.
          // The breaching message itself is still persisted below.
          if (maxTurns > 0 && stats.messages > maxTurns) {
            fireMaxTurns?.();
          }
          break;
        case 'thinking':
          stats.thinking++;
          break;
        case 'run_stalled':
          // Synthetic watchdog diagnosis (plan 026) — emitted by the race
          // arm directly, never through this funnel; arm kept defensive
          // for adapters that might surface it.
          break;
        case 'session_error':
          stats.errors++;
          stderrLines.push(
            `[${event.timestamp}] ${event.data.errorType ?? 'ERROR'}: ${event.data.message ?? ''}`,
          );
          break;
        case 'provider_stream_aborted':
          // Plan 025 FX012 — the NDJSON append below persists the event
          // itself; the run.json terminalReason write happens post-run.
          streamAborted = true;
          break;
        case 'session_start':
          if (event.data.sessionId) {
            activeSessionId = event.data.sessionId;
            // Immediate (non-throttled) — sessionId + active is the answer
            // attach-by-id needs as fast as possible.
            trackManifestUpdate(
              updateManifest(runDir, {
                sessionId: event.data.sessionId,
                status: 'active',
              }),
            );
          }
          break;
      }

      // Write to NDJSON incrementally
      fs.appendFileSync(eventsPath, `${JSON.stringify(event)}\n`);

      // Throttled counter patch — coalesces per-event tick to avoid disk thrash.
      trackManifestUpdate(
        updateManifest(
          runDir,
          {
            counters: {
              events: stats.total,
              toolCalls: stats.toolCalls,
              messages: stats.messages,
              errors: stats.errors,
            },
          },
          { throttleMs: 250 },
        ),
      );

      if (onEvent) onEvent(event);
    };

    // Execute agent with timeout
    let agentResult: AgentResult;
    let adapterSettled = false;
    let runPromise: Promise<AgentResult> | undefined;

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
      // Plan 009 Phase 2 — caller hook (e.g., --human flag) runs alongside.
      // FX008 (plan 016) — caller now also receives `coordinated` and
      // `agentSlug` so the InputBridge can route footer input to the
      // outside inbox lane for coordinated runs.
      try {
        config.onSessionReady?.(sender, {
          runDir,
          runId,
          coordinated: coordinationEnabled,
          agentSlug: definition.slug,
        });
      } catch (err) {
        handleForwarderError(
          err instanceof Error ? err : new Error(String(err)),
        );
      }
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
            if (
              !s.cwd &&
              (!s.type || s.type === 'local' || s.type === 'stdio')
            ) {
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

      // Plan 026 review FT-002 — all three budget race arms are built BEFORE
      // adapter.run() so a synchronously-emitting adapter can never breach a
      // budget while fireStall/fireMaxTurns are still undefined. Each arm
      // gets a noop catch: if it fires during adapter.run()'s synchronous
      // startup (before Promise.race attaches), the rejection is already
      // handled.
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          if (budgetBreached()) return;
          timedOut = true;
          reject(new Error(budgetMessages.timeout));
        }, timeoutMs);
      });
      timeoutPromise.catch(() => {});
      // Plan 026 (CD-02) — the stall arm. The synthetic run_stalled event
      // is emitted HERE (not via handleEvent) so it cannot reset the
      // deadline or re-trigger the arm.
      const stallPromise = new Promise<never>((_, reject) => {
        fireStall = () => {
          if (budgetBreached()) return;
          stalled = true;
          const stalledEvent: AgentEvent = {
            type: 'run_stalled',
            timestamp: new Date().toISOString(),
            data: {
              stallTimeoutSec,
              ...(lastEventAt && { lastEventAt }),
            },
          };
          stats.total++;
          try {
            fs.appendFileSync(eventsPath, `${JSON.stringify(stalledEvent)}\n`);
          } catch {
            // best-effort — run.json + completed.json still carry the stall
          }
          if (onEvent) onEvent(stalledEvent);
          reject(new Error(budgetMessages['stalled-stream']));
        };
        // Arm the initial deadline — a run that emits nothing at all must
        // still stall rather than wait for the wall-clock budget.
        resetStallDeadline();
      });
      stallPromise.catch(() => {});
      // Plan 026 (CD-03) — the turn-budget arm; fired synchronously from
      // handleEvent's message-count increment.
      const maxTurnsPromise = new Promise<never>((_, reject) => {
        fireMaxTurns = () => {
          if (budgetBreached()) return;
          turnsExceeded = true;
          reject(new Error(budgetMessages['max-turns']));
        };
      });
      maxTurnsPromise.catch(() => {});

      runPromise = adapter
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
          ...(config.skillDirectories && {
            skillDirectories: config.skillDirectories,
          }),
          ...(config.disabledSkills && {
            disabledSkills: config.disabledSkills,
          }),
          ...(permissionHandler && { permissionHandler }),
        })
        .then(async (result) => {
          adapterSettled = true;
          if (budgetBreached()) return result;
          await drainTrackedManifestUpdates();
          if (budgetBreached()) return result;
          // Manifest: status → completing right before terminal-condition wait
          // (workshop 002 §Write points).
          await updateManifest(runDir, { status: 'completing' });
          if (budgetBreached()) return result;
          const terminal = await awaitTerminalCondition(result, () =>
            budgetBreached() ? 0 : pendingForwarderCount(),
          );
          if (budgetBreached()) return terminal;
          if (forwarderErrors.length > 0) throw forwarderErrors[0];
          if (terminal.status === 'completed') {
            inboxForwarder?.commit();
            stateForwarder?.commit();
          }
          return terminal;
        })
        .finally(closeForwarders);
      agentResult = await Promise.race([
        runPromise,
        timeoutPromise,
        stallPromise,
        maxTurnsPromise,
      ]);
    } catch (error) {
      if (budgetBreached()) {
        try {
          // Plan 026 (CD-01) — bounded: a terminate() hanging on dead RPC
          // must never block the terminal writes below.
          await withDeadline(
            adapter.terminate(activeSessionId),
            cleanupGraceMs,
          );
        } catch {
          /* best-effort */
        }
        closeForwarders();
        if (adapterSettled && runPromise) {
          try {
            await runPromise;
          } catch {
            /* timeout result is already canonical */
          }
        }
        agentResult = {
          output: timedOut
            ? budgetMessages.timeout
            : stalled
              ? budgetMessages['stalled-stream']
              : budgetMessages['max-turns'],
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
      if (stallHandle) clearTimeout(stallHandle);
      closeForwarders();
    }

    // Plan 018 R1 — if a permission denial fired during the run, persist
    // signals 2 (run.json) here. Signals 3+4 (inside-state, outside-inbox)
    // already fired inside the handler closure. Mandatory regardless of
    // whether the SDK reported `failed` or wedged — the denial is the
    // truth.
    if (denialState.terminalFired && denialState.payload) {
      try {
        await updateManifest(runDir, {
          status: 'failed',
          terminalReason: denialState.reason ?? 'permission-denied',
          permissionError: {
            kind: denialState.payload.kind,
            decision: denialState.payload.decision,
            occurredAt: denialState.payload.occurredAt,
            message: denialState.payload.message,
            toolName: denialState.payload.toolName,
            attemptedPath: denialState.payload.attemptedPath,
            requestId: denialState.payload.requestId,
            toolCallId: denialState.payload.toolCallId,
            policyDigest: denialState.payload.policyDigest,
          },
          ...(denialState.signalFailures.length > 0 && {
            coordinationSignals: denialState.signalFailures,
          }),
        });
      } catch {
        // best-effort
      }
      // Override agentResult to the canonical denial shape.
      if (agentResult.status !== 'killed') {
        agentResult = {
          output: denialState.payload.message,
          sessionId: agentResult.sessionId,
          status: 'failed',
          exitCode: denialState.exitCode,
          tokens: agentResult.tokens,
        };
      }
    }

    // Plan 025 FX012 — persist the stream-abort diagnosis to run.json.
    // The permission-denial write above is the more specific diagnosis and
    // takes precedence (preservation: never overwrite its terminalReason).
    if (streamAborted && !denialState.terminalFired) {
      try {
        await updateManifest(runDir, {
          status: 'failed',
          terminalReason: 'provider-stream-aborted',
        });
      } catch {
        // best-effort — events.ndjson + completed.json still carry the abort
      }
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
      // Plan 027 Phase 5 (#35) — shutdown drain (AC-13). Re-derive the ledger
      // over the RAW live lanes AFTER the final inbox forward-commit (above,
      // inside the resolved run promise) and BEFORE report.json is snapshotted,
      // so a peer message that landed in the shutdown / report-write window is
      // captured in report.findings[] rather than stranded (plan Findings 05/06).
      // Disk-only — MCP teardown is implicit/SDK-owned (PIC-P5-C). Best-effort:
      // a torn lane is tolerated inside drainAndReadInbox, and this whole block
      // never fails an otherwise-successful run (PIC-P5-G).
      try {
        const drained = drainAndReadInbox(
          coordinationRunLocation(definition.slug, agentsDir, runId),
        );
        if (drained === null) {
          // log + skip (PIC-P5-G) — torn lane is tolerated but NOT silent (F002).
          stderrLines.push(
            '[coordination-drain] inbox re-derive skipped — corrupt/torn lane in the shutdown window; report findings left as authored (run not failed).',
          );
        } else {
          const outcome = reconcileReportFindings(outputPath, drained);
          // Only surface the ABNORMAL skip (a valid ledger whose draft failed
          // validation). `report-absent` / `report-unparseable` are the EXPECTED
          // no-structured-report paths (non-JSON agents / raw SDK fallback) and
          // stay quiet so they don't manufacture a stderr artifact (F002).
          if (!outcome.wrote && outcome.reason === 'draft-invalid') {
            stderrLines.push(
              '[coordination-drain] report.findings[] not reconciled (draft-invalid); preserved as authored.',
            );
          }
        }
      } catch (error) {
        // best-effort — shutdown-drain hiccups must not fail the run, but say why.
        const message = error instanceof Error ? error.message : String(error);
        stderrLines.push(
          `[coordination-drain] non-fatal drain error: ${message}`,
        );
      }

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
      : systemValidation.valid &&
        (userValidation ? userValidation.valid : true);

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
      ...(config.label && { label: config.label }),
      ...(config.paramsSummary && { paramsSummary: config.paramsSummary }),
      ...(config.resumedFromRunId && {
        resumedFromRunId: config.resumedFromRunId,
      }),
      ...(velocity && { velocity }),
      // FX008-4 — surface the denial reason so the CLI can route to
      // ErrorCodes.COORDINATION_WRITE_DENIED (E205) for coord-write-deny
      // and ErrorCodes.PERMISSION_DENIED (E200) for SDK-kind denials,
      // instead of falling through to generic AGENT_EXECUTION_FAILED.
      ...(denialState.terminalFired &&
        denialState.payload && {
          permissionError: {
            kind: denialState.payload.kind,
            decision: denialState.payload.decision,
            message: denialState.payload.message,
          },
        }),
    };

    fs.writeFileSync(
      path.join(runDir, 'completed.json'),
      JSON.stringify(metadata, null, 2),
    );

    // Final manifest patch — flush any pending throttled counters and mark
    // the run completed/failed so attach commands can render an honest
    // capability label even before they read completed.json.
    //
    // Plan 026 — budget reasons ride this patch. More-specific reasons
    // (permission-denied, provider-stream-aborted) were already persisted
    // above and take precedence (preservation invariant).
    const budgetReason = timedOut
      ? ('timeout' as const)
      : stalled
        ? ('stalled-stream' as const)
        : turnsExceeded
          ? ('max-turns' as const)
          : undefined;
    await drainTrackedManifestUpdates();
    await flushManifestThrottled(runDir);
    await updateManifest(runDir, {
      status: resultStatus === 'completed' ? 'completed' : 'failed',
      sessionId: agentResult.sessionId || null,
      ...(budgetReason &&
        !denialState.terminalFired &&
        !streamAborted && { terminalReason: budgetReason }),
      counters: {
        events: stats.total,
        toolCalls: stats.toolCalls,
        messages: stats.messages,
        errors: stats.errors,
      },
    });

    // Parse report.json for envelope surfacing
    const parsedReport = parseReportJson(outputPath);

    // Plan 011 / Workshop 002 — auto-append the retro to the project ledger.
    // Wired at every terminal-result branch (success / degraded / failed / timeout).
    // Honors MINIH_NO_AUTO_HARVEST=1 (helper handles opt-out). The surrounding
    // try/finally guarantees a `crashed` stub if an uncaught exception bypasses
    // this point.
    if (
      parsedReport &&
      resultStatus !== 'failed' &&
      resultStatus !== 'timeout'
    ) {
      const retro: RetrospectiveLike = {
        summary: parsedReport.summary,
        magicWand: parsedReport.magicWand,
        magicWandTarget:
          typeof parsedReport.magicWandTarget === 'string'
            ? parsedReport.magicWandTarget
            : null,
        difficulties: parsedReport.difficulties?.map((d) => ({
          category: d.category,
          description: d.description,
          workaround: d.workaround,
          severity: d.severity,
        })),
      };
      if (retro.magicWand) {
        await tryAutoHarvestRetro(harvestCtx, retro);
      }
    }
    if (
      !harvestCtx.done.value &&
      (resultStatus === 'failed' || resultStatus === 'timeout')
    ) {
      const tail = stderrLines.slice(-1)[0] ?? '';
      const r: RetroResult = resultStatus === 'timeout' ? 'timeout' : 'failed';
      await tryAutoHarvestStub(harvestCtx, r, tail);
    }

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
  } finally {
    // Crash safety: if we got here without writing anything, the run must
    // have crashed mid-flight. Emit a stub so the operator has a marker.
    if (!harvestCtx.done.value) {
      try {
        await tryAutoHarvestStub(harvestCtx, 'crashed', '');
      } catch {
        // last-resort handler swallows; never throw out of finally.
      }
    }
  }
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

/**
 * Read sidecar permission policy (Plan 018 R3 introduces `lockedDefault`).
 *
 * R1 stub: looks for `agentDir/.minih-source.json` and returns
 * `{ preset: lockedDefault }` if the field is present. R3 extends with
 * `lockedDefaultRecordedAt`/`lockedDefaultReason` and the lossless-preservation
 * invariant test.
 */
function readSidecarPermissions(
  agentDir: string,
): PermissionPolicy | undefined {
  const sidecarPath = path.join(agentDir, '.minih-source.json');
  if (!fs.existsSync(sidecarPath)) return undefined;
  try {
    const raw = JSON.parse(fs.readFileSync(sidecarPath, 'utf-8'));
    if (raw && typeof raw === 'object') {
      const lockedDefault = (raw as Record<string, unknown>).lockedDefault;
      if (typeof lockedDefault === 'string') {
        return { preset: lockedDefault as PermissionPolicy['preset'] };
      }
    }
  } catch {
    // malformed sidecar — fall through (doctor surfaces the problem)
  }
  return undefined;
}

/**
 * Read `MINIH_PERMISSIONS_DEFAULT` env var. Plan 018 R2 (T-R2.9) — escape
 * hatch for users who want a different default during the rollout.
 */
function readEnvPermissions(): PermissionPolicy | undefined {
  const v = process.env.MINIH_PERMISSIONS_DEFAULT;
  if (!v) return undefined;
  const trimmed = v.trim();
  const validPresets = [
    'yolo',
    'trusted',
    'restricted',
    'read-only',
    'network',
    'build-only',
  ];
  if (!validPresets.includes(trimmed)) {
    throw new Error(
      `MINIH_PERMISSIONS_DEFAULT must be one of: ${validPresets.join(', ')}; got "${trimmed}"`,
    );
  }
  return { preset: trimmed as PermissionPolicy['preset'] };
}

/**
 * True iff the resolved policy MAY produce a denial. Pure-yolo policies
 * (every kind = allow + no allowedRoots restrictions beyond the default)
 * fall through to the adapter's built-in `approveAll` for backward-compat.
 *
 * R1 conservative test: any non-allow decision OR any explicit
 * frontmatter-supplied allowedRoots = "non-default".
 */
function isNonDefaultPolicy(policy: ResolvedPolicy): boolean {
  if (policy.presetName !== 'yolo') return true;
  for (const decision of Object.values(policy.decisions)) {
    if (decision !== 'allow') return true;
  }
  // Default allowedRoots resolution always produces 1 root from git/cwd.
  // If we have multiple sources contributing, treat as non-default.
  const explicitSources = policy.rootsResolvedFrom.filter(
    (p) => p.source !== 'git-root' && p.source !== 'cwd-fallback',
  );
  return explicitSources.length > 0;
}
