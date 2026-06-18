/**
 * minih resume <slug> <message> — send a follow-up to a prior session,
 * resuming in the same run dir by default (Plan 010 HF-003 / Workshop 001).
 *
 * Default behavior: reuse the original runId + runDir + SDK sessionId.
 * Eligibility (active/stale/completed/failed) is determined via
 * `detectRunState`. The lock contract (`resume-intent.lock`) prevents
 * concurrent takeovers.
 *
 * Flags:
 *   --resume-prompt <text>  Send a `[SYSTEM RESUME]` envelope as a
 *                           dedicated turn before the user message.
 *   --takeover              Allow takeover of an `active` run (SIGTERM
 *                           with 5s grace, then SIGKILL). TTY confirms
 *                           unless --yes.
 *   --fresh                 Opt back into pre-HF-003 behavior: allocate
 *                           a NEW run dir; SDK conversation continues.
 *   --yes                   Bypass TTY confirmation for --takeover.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createInterface } from 'node:readline';
import { context } from '@opentelemetry/api';
import type { Command } from 'commander';
import { buildInsideMcpServerConfig } from '../../mcp/index.js';
import type {
  AgentRunConfig,
  RunEligibilityState,
} from '../../runner/index.js';
import {
  clearResumeLock,
  coordinationRunLocation,
  detectRunState,
  displayEvent,
  displayHeader,
  displayPreflight,
  displaySummary,
  findRunSession,
  isProcessAliveDefault,
  listActiveRunCandidates,
  listAgents,
  loadMcpConfig,
  MultipleActiveRunsError,
  PrettyDisplay,
  type ResumeLockContent,
  resolveAgent,
  runAgent,
  validateSlug,
  waitForResumeLock,
} from '../../runner/index.js';
import {
  createLogger,
  getParentContext,
  setBaggage,
  withSpan,
} from '../../telemetry/index.js';
import { parseBudgetFlag, resolveEffectiveBudgets } from '../budget-flags.js';
import {
  ErrorCodes,
  exitWithEnvelope,
  formatError,
  formatSuccess,
  printEnvelope,
} from '../output.js';
import { assertOutsideContext } from '../preaction-context.js';
import { hasSkillErrors, resolveSkillsConfig } from '../skills.js';
import { createSdkRuntime } from './sdk-runtime.js';

const RESUME_LOCK_WAIT_MS = 35_000;
const SIGTERM_GRACE_MS = 5_000;

interface ResumeFlagOpts {
  run?: string;
  timeout?: string;
  stallTimeout?: string;
  maxTurns?: string;
  verbose?: boolean;
  human?: boolean;
  mcpConfig?: string;
  skillSource?: string[];
  skill?: string[];
  disableSkill?: string[];
  skills?: boolean;
  skillsDebug?: boolean;
  resumePrompt?: string;
  takeover?: boolean;
  fresh?: boolean;
  yes?: boolean;
}

function buildSystemResumeEnvelope(opts: {
  reason: string;
  fromState: RunEligibilityState;
  previousPid: number | null;
}): string {
  const ts = new Date().toISOString();
  const lines = [
    '[SYSTEM RESUME]',
    `  ts: ${ts}`,
    `  reason: ${opts.reason}`,
    `  fromState: ${opts.fromState}`,
  ];
  if (opts.previousPid != null) {
    lines.push(`  previousPid: ${opts.previousPid}`);
  }
  lines.push('');
  lines.push(
    '(continue from your last task — your inbox and state are intact)',
  );
  return lines.join('\n');
}

async function confirmTakeover(
  pid: number,
  startedAtIso: string,
): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  return await new Promise((resolve) => {
    rl.question(
      `This will SIGTERM pid ${pid} (started ${startedAtIso}). Continue? [y/N] `,
      (answer) => {
        rl.close();
        resolve(/^y(es)?$/i.test(answer.trim()));
      },
    );
  });
}

async function takeoverActive(pid: number): Promise<void> {
  if (!isProcessAliveDefault(pid)) return;
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return;
  }
  const deadline = Date.now() + SIGTERM_GRACE_MS;
  while (Date.now() < deadline) {
    if (!isProcessAliveDefault(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (isProcessAliveDefault(pid)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
}

export function registerResumeCommand(program: Command): void {
  program
    .command('resume <slug> [message]')
    .description(
      'Resume a coordinated agent session in the same run dir (default) or a fresh one (--fresh)',
    )
    .hook('preAction', () => {
      assertOutsideContext({
        commandName: 'resume',
        alternatives: [
          'Use the inbox/state MCP tools from inside the session.',
          'From an outside shell, use `minih outside inbox send <slug>` to send a new message.',
        ],
      });
    })
    .addHelpText(
      'after',
      '\nExamples:\n' +
        '  minih resume code-review-companion\n' +
        '  minih resume code-review-companion "carry on with FX001-7"\n' +
        '  minih resume code-review-companion --resume-prompt "MCP rebuilt"\n' +
        '  minih resume code-review-companion --takeover --yes\n' +
        '  minih resume code-review-companion --fresh "fresh start"\n' +
        '\nAfter the run completes, `minih harvest <slug>` captures the retro into `docs/retros/`.\n',
    )
    .option('--run <runId>', 'Resume a specific run (default: latest eligible)')
    .option(
      '--resume-prompt <text>',
      'Send a [SYSTEM RESUME] envelope before any user message',
    )
    .option(
      '--takeover',
      'Allow takeover of an `active` run (SIGTERM, then SIGKILL after 5s)',
    )
    .option(
      '--fresh',
      'Allocate a NEW run dir (legacy behavior); SDK session continues',
    )
    .option('--yes', 'Bypass TTY confirmation for --takeover')
    .option(
      '-t, --timeout <seconds>',
      'Timeout in seconds (default: agent frontmatter or 900)',
    )
    .option(
      '--stall-timeout <seconds>',
      'Inactivity watchdog: fail the run when no provider event arrives for this many seconds; 0 disables (default: 300)',
    )
    .option(
      '--max-turns <count>',
      'Fail the run after this many consolidated assistant messages; 0 = unlimited (default: 0)',
    )
    .option('--verbose', 'Show all events with timestamps (verbose mode)')
    .option(
      '--human',
      'Mount the live human-view TUI to stderr (mutually-exclusive with --verbose)',
    )
    .option('--mcp-config <path>', 'MCP config file with mcpServers (JSON)')
    .option(
      '--skill-source <alias-or-path>',
      'Skill source alias/path to load for the resumed SDK session (repeatable)',
      (val: string, acc: string[]) => {
        acc.push(val);
        return acc;
      },
      [] as string[],
    )
    .option(
      '--skill <name>',
      'Load only a named skill from configured sources (repeatable)',
      (val: string, acc: string[]) => {
        acc.push(val);
        return acc;
      },
      [] as string[],
    )
    .option(
      '--disable-skill <name>',
      'Disable/exclude a skill by name (repeatable)',
      (val: string, acc: string[]) => {
        acc.push(val);
        return acc;
      },
      [] as string[],
    )
    .option('--no-skills', 'Disable .minih.json skills for this invocation')
    .option('--skills-debug', 'Print resolved skills config before resuming')
    .action(
      async (
        slug: string,
        messageArg: string | undefined,
        opts: ResumeFlagOpts,
      ) => {
        const agentsDir = program.opts().agentsDir ?? 'agents';

        if (opts.human && opts.verbose) {
          exitWithEnvelope(
            formatError(
              'resume',
              ErrorCodes.INVALID_ARGS,
              '--human and --verbose are mutually exclusive.',
              { provided: ['--human', '--verbose'] },
            ),
          );
        }

        // Plan 026 — budget flags validate loudly (E108) before any run
        // resolution or takeover side effects.
        parseBudgetFlag(
          'resume',
          '--timeout',
          opts.timeout,
          'positive-seconds',
        );
        parseBudgetFlag(
          'resume',
          '--stall-timeout',
          opts.stallTimeout,
          'non-negative-seconds',
        );
        parseBudgetFlag(
          'resume',
          '--max-turns',
          opts.maxTurns,
          'non-negative-count',
        );

        let message = messageArg ?? '';
        if (!message && !process.stdin.isTTY) {
          const chunks: Buffer[] = [];
          for await (const chunk of process.stdin) {
            chunks.push(chunk);
          }
          message = Buffer.concat(chunks).toString('utf-8').trim();
        }

        const slugError = validateSlug(slug);
        if (slugError) {
          exitWithEnvelope(
            formatError('resume', ErrorCodes.INVALID_ARGS, slugError),
          );
          return;
        }

        const definition = resolveAgent(slug, agentsDir);
        if (!definition) {
          const available = listAgents(agentsDir).map((a) => a.slug);
          exitWithEnvelope(
            formatError(
              'resume',
              ErrorCodes.AGENT_NOT_FOUND,
              `Agent "${slug}" not found.${available.length ? ` Available: ${available.join(', ')}` : ' No agents defined yet.'}`,
            ),
          );
          return;
        }

        // Resolve the run to resume. Active ambiguity pre-scan: findRunSession
        // is completed-only, so it would otherwise miss N-active/0-completed.
        const activeAmbiguity = await resolveResumeActiveAmbiguity({
          slug,
          agentsDir,
          runId: opts.run,
        });
        if (activeAmbiguity) {
          exitWithEnvelope(
            formatError(
              'resume',
              ErrorCodes.AMBIGUOUS_RUN_ID,
              `Multiple active runs found for "${slug}". Pass --run <runId> or inspect with minih runs list --active --slug ${slug}.`,
              {
                slug,
                candidates: activeAmbiguity.candidates,
                remedies: [
                  `minih runs list --active --slug ${slug}`,
                  `minih resume ${slug} --run <runId>`,
                ],
              },
            ),
          );
        }
        const session = findRunSession(slug, agentsDir, opts.run);
        if (!session) {
          const hint = opts.run
            ? `Run "${opts.run}" not found or has no session.`
            : `No completed runs found for "${slug}".`;
          exitWithEnvelope(
            formatError(
              'resume',
              ErrorCodes.NO_RUN_TO_RESUME,
              `${hint} Run \`minih run ${slug}\` for a fresh start.`,
            ),
          );
          return;
        }

        // Detect eligibility.
        const fromState = await detectRunState(session.runDir);
        if (fromState === 'nonexistent') {
          exitWithEnvelope(
            formatError(
              'resume',
              ErrorCodes.NO_RUN_TO_RESUME,
              `Run dir not found: ${session.runDir}`,
            ),
          );
          return;
        }

        // Read the prior pid for the lock + resume-prompt envelope.
        let previousPid: number | null = null;
        try {
          const manifest = JSON.parse(
            fs.readFileSync(path.join(session.runDir, 'run.json'), 'utf8'),
          );
          if (typeof manifest.pid === 'number') previousPid = manifest.pid;
        } catch {
          // No manifest or torn — fine; previousPid stays null.
        }

        // Active-run guard.
        if (fromState === 'active' && !opts.takeover && !opts.fresh) {
          exitWithEnvelope(
            formatError(
              'resume',
              ErrorCodes.ALREADY_ACTIVE,
              `run ${session.runId} is currently active${
                previousPid != null ? ` (pid ${previousPid})` : ''
              }; pass --takeover to override or --fresh for a new run dir`,
              { runId: session.runId, previousPid },
            ),
          );
          return;
        }

        // TTY confirmation for active takeover.
        if (
          fromState === 'active' &&
          opts.takeover &&
          !opts.fresh &&
          !opts.yes
        ) {
          if (!process.stdin.isTTY) {
            exitWithEnvelope(
              formatError(
                'resume',
                ErrorCodes.INVALID_ARGS,
                '--takeover against an active run requires --yes in non-TTY contexts',
              ),
            );
            return;
          }
          const startedAt = (() => {
            try {
              const m = JSON.parse(
                fs.readFileSync(path.join(session.runDir, 'run.json'), 'utf8'),
              );
              return typeof m.startedAt === 'string' ? m.startedAt : 'unknown';
            } catch {
              return 'unknown';
            }
          })();
          const ok = await confirmTakeover(previousPid ?? 0, startedAt);
          if (!ok) {
            exitWithEnvelope(
              formatError(
                'resume',
                ErrorCodes.INVALID_ARGS,
                'takeover declined',
              ),
            );
            return;
          }
        }

        // Acquire resume-intent.lock for in-place runs (skip for --fresh).
        const useInPlace = !opts.fresh;
        const lockContent: ResumeLockContent = {
          pid: process.pid,
          startedAt: new Date().toISOString(),
          originalSessionId: session.sessionId,
          kind:
            fromState === 'active'
              ? 'takeover'
              : fromState === 'stale'
                ? 'stale-revive'
                : 'completed-followup',
        };

        if (useInPlace) {
          const lockResult = await waitForResumeLock(
            session.runDir,
            lockContent,
            { maxWaitMs: RESUME_LOCK_WAIT_MS },
          );
          if (!lockResult.acquired) {
            exitWithEnvelope(
              formatError(
                'resume',
                ErrorCodes.RESUME_IN_PROGRESS,
                `another resume is in progress for run ${session.runId} (lock held by pid ${lockResult.holder.pid})`,
                {
                  runId: session.runId,
                  holderPid: lockResult.holder.pid,
                  holderStartedAt: lockResult.holder.startedAt,
                },
              ),
            );
            return;
          }
        }

        // Active takeover signal sequence.
        if (
          useInPlace &&
          fromState === 'active' &&
          opts.takeover &&
          previousPid != null &&
          previousPid !== process.pid
        ) {
          await takeoverActive(previousPid);
        }

        try {
          await runResumed({
            slug,
            agentsDir,
            definition,
            session,
            message,
            opts,
            fromState,
            previousPid,
            useInPlace,
          });
        } finally {
          if (useInPlace) {
            await clearResumeLock(session.runDir);
          }
        }
      },
    );
}

async function resolveResumeActiveAmbiguity(opts: {
  slug: string;
  agentsDir: string;
  runId?: string;
}): Promise<MultipleActiveRunsError | null> {
  if (opts.runId) return null;
  const active = await listActiveRunCandidates({
    slug: opts.slug,
    mode: { kind: 'latest-active' },
    agentsDir: opts.agentsDir,
  });
  if (active.candidates.length <= 1) return null;
  return new MultipleActiveRunsError(opts.slug, active.candidates);
}

interface RunResumedArgs {
  slug: string;
  agentsDir: string;
  definition: ReturnType<typeof resolveAgent>;
  session: { sessionId: string; runId: string; runDir: string };
  message: string;
  opts: ResumeFlagOpts;
  fromState: RunEligibilityState;
  previousPid: number | null;
  useInPlace: boolean;
}

async function runResumed(args: RunResumedArgs): Promise<void> {
  const { slug, agentsDir, definition, session, message, opts } = args;
  if (!definition) return;

  const isTTY = process.stderr.isTTY;
  const useVerbose = opts.verbose || !isTTY;
  const pretty = opts.human || useVerbose ? null : new PrettyDisplay();

  if (isTTY && !opts.human) {
    displayHeader(slug, '(resuming...)', undefined);
    displayPreflight('Session', true, session.sessionId);
    displayPreflight('Original run', true, session.runId);
    displayPreflight(
      'Mode',
      true,
      args.useInPlace ? `in-place (${args.fromState})` : 'fresh',
    );
    process.stderr.write('\n');
  }

  const resolvedSkills = resolveSkillsConfig({
    cwd: process.cwd(),
    sourceOverrides: opts.skillSource,
    includeOverrides: opts.skill,
    excludeOverrides: opts.disableSkill,
    noSkills: opts.skills === false,
  });
  for (const diagnostic of resolvedSkills.diagnostics) {
    const prefix = diagnostic.level === 'error' ? 'error' : 'warning';
    process.stderr.write(`skills ${prefix}: ${diagnostic.message}\n`);
  }
  if (opts.skillsDebug && resolvedSkills.enabled) {
    process.stderr.write(
      `skills debug: directories=${(resolvedSkills.skillDirectories ?? []).join(', ') || '(none)'} disabled=${(resolvedSkills.disabledSkills ?? []).join(', ') || '(none)'}\n`,
    );
  }
  if (hasSkillErrors(resolvedSkills)) {
    exitWithEnvelope(
      formatError(
        'resume',
        ErrorCodes.SKILL_NOT_FOUND,
        'Could not resolve requested skills.',
        {
          diagnostics: resolvedSkills.diagnostics,
        },
      ),
    );
    return;
  }

  let mcpServers: Record<string, unknown> | undefined;
  if (opts.mcpConfig) {
    try {
      mcpServers = loadMcpConfig(path.resolve(opts.mcpConfig));
    } catch (err) {
      exitWithEnvelope(
        formatError(
          'resume',
          ErrorCodes.INVALID_ARGS,
          err instanceof Error ? err.message : String(err),
        ),
      );
      return;
    }
  }

  // Compose prompt — when --resume-prompt is set, prefix with [SYSTEM RESUME]
  // envelope. When both envelope and message exist, send envelope first as a
  // separate turn (Workshop 001 § Q2 — separate turn for cleaner transcript).
  const envelope = opts.resumePrompt
    ? buildSystemResumeEnvelope({
        reason: opts.resumePrompt,
        fromState: args.fromState,
        previousPid: args.previousPid,
      })
    : null;

  // Resolve the prompt for runAgent. We send envelope OR user message OR
  // a default reorient cue. Sequential turns (envelope then message) are
  // out of scope for v1 single-shot runAgent; the envelope/message
  // composition follows: envelope with appended message if both present.
  let promptOverride: string;
  if (envelope && message) {
    promptOverride = `${envelope}\n\n---\n\n${message}`;
  } else if (envelope) {
    promptOverride = envelope;
  } else if (message) {
    promptOverride = message;
  } else {
    // No-prompt resume — agent should re-check inbox via long-poll.
    promptOverride =
      '(resumed) Check your inbox and continue from your last task.';
  }

  // Plan 009 — humanHandle.ref pattern lets us tear down the renderer on
  // run completion (mirrors run.ts).
  const humanHandle: {
    ref: {
      unmount(): void;
      updateBridge(b: import('../human/input-bridge.js').InputBridge): void;
    } | null;
  } = { ref: null };

  // Plan 026 (CD-05) — resume shares run's default-timeout source
  // (frontmatter-aware, then the shared constant; the '300' hardcode is gone).
  // FT-004 — one resolution path with `run`, unit-pinned in
  // test/cli/budget-flags.test.ts.
  const effectiveBudgets = resolveEffectiveBudgets(
    'resume',
    opts,
    definition.timeout,
    definition.stallTimeout,
  );
  const config: AgentRunConfig = {
    slug,
    timeout: effectiveBudgets.timeout,
    stallTimeout: effectiveBudgets.stallTimeout,
    maxTurns: effectiveBudgets.maxTurns,
    // Plan 028 Phase 5 — carry the survive-gaps profile through a resume too,
    // so a re-taken-over companion keeps its heartbeat.
    ...(definition.surviveGaps && { surviveGaps: true }),
    cwd: process.cwd(),
    sessionId: session.sessionId,
    resumedFromRunId: session.runId,
    promptOverride,
    insideMcpServerFactory: ({ runId, runDir, agentSlug, agentsDir: a }) =>
      buildInsideMcpServerConfig({
        runId,
        runDir,
        agentSlug,
        agentsDir: a,
      }),
    reservedMcpToolPrefixes: ['inbox_', 'state_'],
    ...(mcpServers && { mcpServers }),
    ...(resolvedSkills.skillDirectories && {
      skillDirectories: resolvedSkills.skillDirectories,
    }),
    ...(resolvedSkills.disabledSkills && {
      disabledSkills: resolvedSkills.disabledSkills,
    }),
    ...(args.useInPlace && {
      resumeInPlace: true,
      resumeFromState:
        args.fromState === 'nonexistent'
          ? undefined
          : (args.fromState as 'active' | 'stale' | 'completed' | 'failed'),
      resumeKind:
        args.fromState === 'active'
          ? 'takeover'
          : args.fromState === 'stale'
            ? 'stale-revive'
            : 'completed-followup',
      ...(args.previousPid != null && { resumePreviousPid: args.previousPid }),
    }),
    ...(opts.human && {
      onSessionReady: async (sender, ctx) => {
        try {
          const { createRunFeed } = await import('../human/run-feed.js');
          const { createInputBridge } = await import(
            '../human/input-bridge.js'
          );
          const { mountHumanApp, pushHumanModel } = await import(
            '../human/app.js'
          );
          const { buildHumanViewModel } = await import('../../runner/index.js');

          const feed = await createRunFeed({
            runDir: ctx.runDir,
            onUpdate: (model) => pushHumanModel(model),
          });
          const initialSources = await feed.readSnapshot();
          const initialModel = buildHumanViewModel(initialSources);

          const bridge = createInputBridge({
            sender,
            attached: false,
            runStatus: 'active',
            runDir: ctx.runDir,
            agentSlug: ctx.agentSlug,
            coordinated: ctx.coordinated,
            commandName: 'human-tui.input',
            ...(ctx.coordinated && {
              location: coordinationRunLocation(
                ctx.agentSlug,
                agentsDir,
                ctx.runId,
              ),
            }),
          });

          // FX002 + Ctrl-C bug: shared exit guard across signal + in-TUI Ctrl-C.
          const handleRef: { current: { unmount(): void } | null } = {
            current: null,
          };
          let exited = false;
          const onSig = (code: number): void => {
            if (exited) return;
            exited = true;
            handleRef.current?.unmount();
            setImmediate(() => process.exit(code));
          };

          humanHandle.ref = mountHumanApp({
            feed,
            bridge,
            initial: initialModel,
            onExitRequest: () => onSig(130),
          });
          handleRef.current = humanHandle.ref;

          process.once('SIGINT', () => onSig(130));
          process.once('SIGTERM', () => onSig(143));
        } catch (err) {
          process.stderr.write(
            `human-view mount failed: ${(err as Error).message}\n`,
          );
        }
      },
    }),
  };

  const runtime = await createSdkRuntime('resume', () => pretty?.cleanup());

  try {
    const log = createLogger('cli.resume');
    log.info(`Command started: resume ${slug}`, {
      'command.name': 'resume',
      'agent.slug': slug,
    });

    // Set baggage for automatic propagation to all child spans (DD5)
    const baggageCtx = setBaggage({
      'minih.agent.slug': slug,
    });

    await context.with(baggageCtx, async () => {
      await withSpan(
        'minih.cli.command',
        async (rootSpan) => {
          rootSpan.setAttribute('command.name', 'resume');
          rootSpan.setAttribute('agent.slug', slug);
          rootSpan.setAttribute('session.id', session.sessionId);

          const onEvent = pretty
            ? (e: import('../../adapter/events.js').AgentEvent) =>
                pretty.handleEvent(e)
            : opts.human
              ? undefined
              : displayEvent;
          const result = await runAgent(
            runtime.adapter,
            definition,
            config,
            onEvent,
            agentsDir,
          );

          pretty?.cleanup();
          if (opts.human && humanHandle.ref) {
            humanHandle.ref.unmount();
            humanHandle.ref = null;
          }
          if (isTTY && !opts.human) {
            displaySummary(result);
          }

          rootSpan.setAttribute('run.id', result.metadata.runId);
          rootSpan.setAttribute('result', result.metadata.result);
          rootSpan.setAttribute('duration_ms', result.metadata.durationMs);

          log.info(`Command completed: resume ${slug}`, {
            'command.name': 'resume',
            'agent.slug': slug,
            'run.id': result.metadata.runId,
            result: result.metadata.result,
            duration_ms: result.metadata.durationMs,
          });

          const status =
            result.metadata.result === 'completed'
              ? 'ok'
              : result.metadata.result === 'degraded'
                ? 'degraded'
                : 'error';

          if (status === 'error') {
            const errorCode =
              result.metadata.result === 'timeout'
                ? ErrorCodes.AGENT_TIMEOUT
                : ErrorCodes.AGENT_EXECUTION_FAILED;
            printEnvelope(
              formatError('resume', errorCode, result.agentResult.output, {
                runDir: result.runDir,
                metadata: result.metadata,
              }),
            );
            process.exitCode = 1;
          } else {
            printEnvelope(
              formatSuccess(
                'resume',
                {
                  slug,
                  runId: result.metadata.runId,
                  runDir: result.runDir,
                  sessionId: result.metadata.sessionId,
                  resumedFromRunId: session.runId,
                  originalSessionId: session.sessionId,
                  inPlace: args.useInPlace,
                  fromState: args.fromState,
                  result: result.metadata.result,
                  durationMs: result.metadata.durationMs,
                  eventCount: result.metadata.eventCount,
                  toolCallCount: result.metadata.toolCallCount,
                },
                status as 'ok' | 'degraded',
              ),
            );
          }
        },
        undefined,
        getParentContext(),
      ); // withSpan
    }); // context.with
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isSessionError =
      /session.*not found|expired|resume|cannot resume/i.test(msg);
    if (isSessionError) {
      exitWithEnvelope(
        formatError(
          'resume',
          ErrorCodes.SESSION_EXPIRED,
          `SDK session for run ${session.runId} has expired; start a fresh run with \`minih run ${slug}\`.`,
          { originalError: msg },
        ),
      );
    }
    if (/spawn|ENOENT|MCP/i.test(msg)) {
      exitWithEnvelope(
        formatError(
          'resume',
          ErrorCodes.MCP_SPAWN_FAILED,
          `MCP subprocess failed to start: ${msg}`,
        ),
      );
    }
    exitWithEnvelope(
      formatError('resume', ErrorCodes.AGENT_EXECUTION_FAILED, msg),
    );
  } finally {
    await runtime.cleanup();
  }
}
