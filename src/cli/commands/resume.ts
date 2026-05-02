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
  listAgents,
  loadMcpConfig,
  PrettyDisplay,
  type ResumeLockContent,
  resolveAgent,
  runAgent,
  validateSlug,
  waitForResumeLock,
} from '../../runner/index.js';
import {
  ErrorCodes,
  exitWithEnvelope,
  formatError,
  formatSuccess,
} from '../output.js';
import { assertOutsideContext } from '../preaction-context.js';
import { createSdkRuntime } from './sdk-runtime.js';

const RESUME_LOCK_WAIT_MS = 35_000;
const SIGTERM_GRACE_MS = 5_000;

interface ResumeFlagOpts {
  run?: string;
  timeout?: string;
  verbose?: boolean;
  human?: boolean;
  mcpConfig?: string;
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
    .option('-t, --timeout <seconds>', 'Timeout in seconds', '300')
    .option('--verbose', 'Show all events with timestamps (verbose mode)')
    .option(
      '--human',
      'Mount the live human-view TUI to stderr (mutually-exclusive with --verbose)',
    )
    .option('--mcp-config <path>', 'MCP config file with mcpServers (JSON)')
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

        // Resolve the run to resume.
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

  const config: AgentRunConfig = {
    slug,
    timeout: Number.parseInt(opts.timeout ?? '300', 10),
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
      exitWithEnvelope(
        formatError('resume', errorCode, result.agentResult.output, {
          runDir: result.runDir,
          metadata: result.metadata,
        }),
      );
    } else {
      exitWithEnvelope(
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
    runtime.cleanup();
  }
}
