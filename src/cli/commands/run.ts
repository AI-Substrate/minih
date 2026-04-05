/**
 * minih run — composition root. Dynamic SDK import.
 *
 * Only CLI command that touches @github/copilot-sdk.
 * DYK #1: try/catch on dynamic import → actionable error if SDK missing.
 * DYK #1 (session): client.stop() in finally, SIGINT for instant Ctrl+C kill.
 * Workshop 005: SDK workingDirectory = runDir for session isolation.
 */

import chalk from 'chalk';
import type { Command } from 'commander';
import { SdkCopilotAdapter } from '../../adapter/index.js';
import type { AgentRunConfig } from '../../runner/index.js';
import {
  displayEvent,
  displayHeader,
  displayPreflight,
  displaySummary,
  listAgents,
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

export function registerRunCommand(program: Command): void {
  program
    .command('run <slug>')
    .description('Execute an agent')
    .option(
      '-m, --model <model>',
      'Model to use (e.g., gpt-5.4, claude-sonnet-4)',
    )
    .option(
      '-r, --reasoning <effort>',
      'Reasoning effort (low, medium, high, xhigh)',
    )
    .option('-t, --timeout <seconds>', 'Timeout in seconds', '300')
    .option(
      '-p, --param <key=value>',
      'Input parameter (repeatable)',
      (val: string, acc: string[]) => {
        acc.push(val);
        return acc;
      },
      [] as string[],
    )
    .action(
      async (
        slug: string,
        opts: {
          model?: string;
          reasoning?: string;
          timeout?: string;
          param?: string[];
        },
      ) => {
        const agentsDir = program.opts().agentsDir ?? 'agents';

        // Pre-flight: validate slug
        const slugError = validateSlug(slug);
        if (slugError) {
          exitWithEnvelope(
            formatError('run', ErrorCodes.INVALID_ARGS, slugError),
          );
        }

        // Pre-flight: check GH_TOKEN
        if (!process.env.GH_TOKEN) {
          exitWithEnvelope(
            formatError(
              'run',
              ErrorCodes.AGENT_AUTH_MISSING,
              'GH_TOKEN environment variable is not set. Required for Copilot SDK.',
              { fix: 'export GH_TOKEN=$(gh auth token)' },
            ),
          );
        }

        // Resolve agent
        const definition = resolveAgent(slug, agentsDir);
        if (!definition) {
          const available = listAgents(agentsDir).map((a) => a.slug);
          exitWithEnvelope(
            formatError(
              'run',
              ErrorCodes.AGENT_NOT_FOUND,
              `Agent "${slug}" not found.${available.length ? ` Available: ${available.join(', ')}` : ' No agents defined yet.'}`,
            ),
          );
          return; // TypeScript flow — exitWithEnvelope is never, but after the guard
        }

        // Parse --param key=value pairs
        const params: Record<string, string> = {};
        for (const p of opts.param ?? []) {
          const eq = p.indexOf('=');
          if (eq < 1) {
            exitWithEnvelope(
              formatError(
                'run',
                ErrorCodes.INVALID_ARGS,
                `Invalid --param format: "${p}". Expected key=value.`,
              ),
            );
          }
          params[p.slice(0, eq)] = p.slice(eq + 1);
        }

        const config: AgentRunConfig = {
          slug,
          model: opts.model,
          reasoningEffort: opts.reasoning as AgentRunConfig['reasoningEffort'],
          timeout: Number.parseInt(opts.timeout ?? '300', 10),
          cwd: process.cwd(),
          params: Object.keys(params).length > 0 ? params : undefined,
        };

        // Display header (stderr, TTY only)
        const isTTY = process.stderr.isTTY;
        if (isTTY) {
          displayHeader(slug, '(starting...)', opts.model);
          displayPreflight('GH_TOKEN', true);
          displayPreflight('Agent definition', true, definition.dir);
          if (config.params) {
            for (const [k, v] of Object.entries(config.params)) {
              displayPreflight(`param:${k}`, true, v);
            }
          }
          process.stderr.write('\n');
        }

        // Dynamic SDK import — actionable error if missing (DYK #1)
        let CopilotClient: new () => { stop(): Promise<unknown> };
        try {
          const sdk = await import('@github/copilot-sdk');
          CopilotClient = sdk.CopilotClient;
        } catch (err: unknown) {
          const code =
            (err as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND' ||
            (err as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND';
          if (code) {
            exitWithEnvelope(
              formatError(
                'run',
                ErrorCodes.AGENT_SDK_MISSING,
                'Install @github/copilot-sdk in your project first: npm install @github/copilot-sdk',
              ),
            );
          }
          throw err;
        }

        // Create client + adapter — composition root
        const client = new CopilotClient();
        // biome-ignore lint/suspicious/noExplicitAny: CopilotClient doesn't implement our ICopilotClient exactly
        const adapter = new SdkCopilotAdapter(client as any);

        // SIGINT handler for instant Ctrl+C kill
        const sigintHandler = () => {
          process.stderr.write(chalk.dim('\n  Interrupted.\n'));
          process.exit(130);
        };
        process.on('SIGINT', sigintHandler);

        try {
          const result = await runAgent(
            adapter,
            definition,
            config,
            isTTY ? displayEvent : undefined,
            agentsDir,
          );

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
              formatError('run', errorCode, result.agentResult.output, {
                runDir: result.runDir,
                metadata: result.metadata,
              }),
            );
          } else {
            exitWithEnvelope(
              formatSuccess(
                'run',
                {
                  slug,
                  runId: result.metadata.runId,
                  runDir: result.runDir,
                  sessionId: result.metadata.sessionId,
                  result: result.metadata.result,
                  durationMs: result.metadata.durationMs,
                  validated: result.metadata.validated,
                  validationErrors: result.metadata.validationErrors,
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
            formatError('run', ErrorCodes.AGENT_EXECUTION_FAILED, msg),
          );
        } finally {
          process.removeListener('SIGINT', sigintHandler);
          await client.stop();
        }
      },
    );
}
