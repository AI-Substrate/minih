/**
 * minih resume <slug> <message> — send a follow-up to a completed session.
 *
 * Mechanically identical to `run` but uses resumeSession() instead of
 * createSession(). The follow-up message is sent as-is — SDK conversation
 * history has the full prior context.
 *
 * System output validation (summary + retrospective) is NOT enforced
 * on resume — the user is asking a pointed follow-up, not requesting
 * a full agent report.
 */

import { context } from '@opentelemetry/api';
import type { Command } from 'commander';
import type { AgentRunConfig } from '../../runner/index.js';
import {
  displayEvent,
  displayHeader,
  displayPreflight,
  displaySummary,
  findRunSession,
  listAgents,
  loadMcpConfig,
  PrettyDisplay,
  resolveAgent,
  runAgent,
  validateSlug,
} from '../../runner/index.js';
import {
  createLogger,
  getParentContext,
  setBaggage,
  withSpan,
} from '../../telemetry/index.js';
import {
  ErrorCodes,
  exitWithEnvelope,
  formatError,
  formatSuccess,
  printEnvelope,
} from '../output.js';
import { createSdkRuntime } from './sdk-runtime.js';

export function registerResumeCommand(program: Command): void {
  program
    .command('resume <slug> [message]')
    .description('Send a follow-up message to a completed agent session')
    .addHelpText(
      'after',
      '\nExamples:\n' +
        '  minih resume smoke-test "Check the test output too"\n' +
        '  minih resume smoke-test --run <runId> "Elaborate on the warning"\n' +
        '  echo "check tests" | minih resume smoke-test\n',
    )
    .option('--run <runId>', 'Resume a specific run (default: latest)')
    .option('-t, --timeout <seconds>', 'Timeout in seconds', '300')
    .option('--verbose', 'Show all events with timestamps (verbose mode)')
    .option('--mcp-config <path>', 'MCP config file with mcpServers (JSON)')
    .action(
      async (
        slug: string,
        messageArg: string | undefined,
        opts: {
          run?: string;
          timeout?: string;
          verbose?: boolean;
          mcpConfig?: string;
        },
      ) => {
        const agentsDir = program.opts().agentsDir ?? 'agents';

        // Resolve message from arg or stdin
        let message = messageArg ?? '';
        if (!message && !process.stdin.isTTY) {
          const chunks: Buffer[] = [];
          for await (const chunk of process.stdin) {
            chunks.push(chunk);
          }
          message = Buffer.concat(chunks).toString('utf-8').trim();
        }
        if (!message.trim()) {
          exitWithEnvelope(
            formatError(
              'resume',
              ErrorCodes.INVALID_ARGS,
              'Missing message. Usage: minih resume <slug> "your message"',
            ),
          );
        }

        // Validate slug
        const slugError = validateSlug(slug);
        if (slugError) {
          exitWithEnvelope(
            formatError('resume', ErrorCodes.INVALID_ARGS, slugError),
          );
        }

        // Resolve agent definition
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

        // Find session from prior run
        const session = findRunSession(slug, agentsDir, opts.run);
        if (!session) {
          const hint = opts.run
            ? `Run "${opts.run}" not found or has no session.`
            : `No completed runs found for "${slug}".`;
          exitWithEnvelope(
            formatError(
              'resume',
              ErrorCodes.AGENT_VALIDATION_FAILED,
              `${hint} Run \`minih run ${slug}\` for a fresh start.`,
            ),
          );
          return;
        }

        // Display setup
        const isTTY = process.stderr.isTTY;
        const useVerbose = opts.verbose || !isTTY;
        const pretty = useVerbose ? null : new PrettyDisplay();

        if (isTTY) {
          displayHeader(slug, '(resuming...)', undefined);
          displayPreflight('Session', true, session.sessionId);
          displayPreflight('Original run', true, session.runId);
          process.stderr.write('\n');
        }

        // MCP config
        let mcpServers: Record<string, unknown> | undefined;
        if (opts.mcpConfig) {
          try {
            const path = await import('node:path');
            mcpServers = loadMcpConfig(path.resolve(opts.mcpConfig));
          } catch (err) {
            exitWithEnvelope(
              formatError(
                'resume',
                ErrorCodes.INVALID_ARGS,
                err instanceof Error ? err.message : String(err),
              ),
            );
          }
        }

        const config: AgentRunConfig = {
          slug,
          timeout: Number.parseInt(opts.timeout ?? '300', 10),
          cwd: process.cwd(),
          sessionId: session.sessionId,
          resumedFromRunId: session.runId,
          promptOverride: message,
          ...(mcpServers && { mcpServers }),
        };

        const runtime = await createSdkRuntime('resume', () =>
          pretty?.cleanup(),
        );

        try {
          const log = createLogger('cli.resume');
          log.info(`Command started: resume ${slug}`, {
            'command.name': 'resume',
            'agent.slug': slug,
          });

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
                  : displayEvent;
                const result = await runAgent(
                  runtime.adapter,
                  definition,
                  config,
                  onEvent,
                  agentsDir,
                );

                pretty?.cleanup();
                if (isTTY) {
                  displaySummary(result);
                }

                rootSpan.setAttribute('run.id', result.metadata.runId);
                rootSpan.setAttribute('result', result.metadata.result);
                rootSpan.setAttribute(
                  'duration_ms',
                  result.metadata.durationMs,
                );

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
                    formatError(
                      'resume',
                      errorCode,
                      result.agentResult.output,
                      {
                        runDir: result.runDir,
                        metadata: result.metadata,
                      },
                    ),
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
                ErrorCodes.AGENT_VALIDATION_FAILED,
                `Session not found — run \`minih run ${slug}\` for a fresh start.`,
                { originalError: msg },
              ),
            );
          }
          exitWithEnvelope(
            formatError('resume', ErrorCodes.AGENT_EXECUTION_FAILED, msg),
          );
        } finally {
          await runtime.cleanup();
        }
      },
    );
}
