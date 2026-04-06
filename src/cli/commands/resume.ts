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

import type { Command } from 'commander';
import type { AgentRunConfig } from '../../runner/index.js';
import {
  displayEvent,
  displayHeader,
  displayPreflight,
  displaySummary,
  findRunSession,
  listAgents,
  PrettyDisplay,
  resolveAgent,
  runAgent,
  validateSlug,
} from '../../runner/index.js';
import {
  ErrorCodes,
  exitWithEnvelope,
  formatError,
  formatSuccess,
} from '../output.js';
import { createSdkRuntime } from './sdk-runtime.js';

export function registerResumeCommand(program: Command): void {
  program
    .command('resume <slug> <message>')
    .description('Send a follow-up message to a completed agent session')
    .option('--run <runId>', 'Resume a specific run (default: latest)')
    .option('-t, --timeout <seconds>', 'Timeout in seconds', '300')
    .option('--verbose', 'Show all events with timestamps (verbose mode)')
    .action(
      async (
        slug: string,
        message: string,
        opts: {
          run?: string;
          timeout?: string;
          verbose?: boolean;
        },
      ) => {
        const agentsDir = program.opts().agentsDir ?? 'agents';

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

        const config: AgentRunConfig = {
          slug,
          timeout: Number.parseInt(opts.timeout ?? '300', 10),
          cwd: process.cwd(),
          sessionId: session.sessionId,
          resumedFromRunId: session.runId,
          promptOverride: message,
        };

        const runtime = await createSdkRuntime('resume', () =>
          pretty?.cleanup(),
        );

        try {
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
          exitWithEnvelope(
            formatError('resume', ErrorCodes.AGENT_EXECUTION_FAILED, msg),
          );
        } finally {
          runtime.cleanup();
        }
      },
    );
}
