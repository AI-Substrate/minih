/**
 * minih run — composition root. Dynamic SDK import.
 *
 * Only CLI command that touches @github/copilot-sdk.
 * DYK #1: try/catch on dynamic import → actionable error if SDK missing.
 * DYK #1 (session): client.stop() in finally, SIGINT for instant Ctrl+C kill.
 * Workshop 005: SDK workingDirectory = runDir for session isolation.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
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
  PrettyDisplay,
  parseFrontmatter,
  resolveAgent,
  runAgent,
  SYSTEM_OUTPUT_INSTRUCTIONS,
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
    .option('--dry-run', 'Preview assembled prompt without executing')
    .option('--verbose', 'Show all events with timestamps (verbose mode)')
    .action(
      async (
        slug: string,
        opts: {
          model?: string;
          reasoning?: string;
          timeout?: string;
          param?: string[];
          dryRun?: boolean;
          verbose?: boolean;
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

        // Resolve agent (needed for both dry-run and real run)
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

        const DEFAULT_MODEL = 'claude-opus-4.6';
        const model =
          opts.model ?? process.env.MINIH_DEFAULT_MODEL ?? DEFAULT_MODEL;

        const config: AgentRunConfig = {
          slug,
          model,
          reasoningEffort: opts.reasoning as AgentRunConfig['reasoningEffort'],
          timeout: Number.parseInt(opts.timeout ?? '300', 10),
          cwd: process.cwd(),
          params: Object.keys(params).length > 0 ? params : undefined,
        };

        // Display setup: pretty (default) or verbose (--verbose / non-TTY)
        const isTTY = process.stderr.isTTY;
        const useVerbose = opts.verbose || !isTTY;
        const pretty = useVerbose ? null : new PrettyDisplay();

        if (isTTY) {
          displayHeader(slug, '(starting...)', model);
          displayPreflight('GH_TOKEN', true);
          displayPreflight('Agent definition', true, definition.dir);
          if (config.params) {
            for (const [k, v] of Object.entries(config.params)) {
              displayPreflight(`param:${k}`, true, v);
            }
          }
          process.stderr.write('\n');
        }

        // Dry-run: preview assembled prompt without executing
        if (opts.dryRun) {
          const rawPrompt = fs.readFileSync(definition.promptPath, 'utf-8');
          const { body: promptBody } = parseFrontmatter(rawPrompt);
          const instructions = definition.instructionsPath
            ? fs.readFileSync(definition.instructionsPath, 'utf-8')
            : null;

          let preambleContent: string | null = null;
          const preamblePath = path.join(
            path.resolve(agentsDir),
            '_shared',
            'preamble.md',
          );
          if (fs.existsSync(preamblePath)) {
            preambleContent = fs
              .readFileSync(preamblePath, 'utf-8')
              .replaceAll('{{REPO_ROOT}}', process.cwd());
          }

          const parts = [
            preambleContent && { label: 'PREAMBLE', content: preambleContent },
            instructions && { label: 'INSTRUCTIONS', content: instructions },
            {
              label: 'OUTPUT HINT',
              content: `Write your final JSON report to: <run-dir>/output/report.json`,
            },
            config.params && {
              label: 'INPUT PARAMS',
              content: Object.entries(config.params)
                .map(([k, v]) => `${k}: ${v}`)
                .join('\n'),
            },
            { label: 'PROMPT', content: promptBody },
            {
              label: 'SYSTEM REQUIREMENTS',
              content: SYSTEM_OUTPUT_INSTRUCTIONS,
            },
          ].filter(Boolean) as Array<{ label: string; content: string }>;

          const totalLength = parts.reduce(
            (sum, p) => sum + p.content.length,
            0,
          );

          process.stderr.write(
            `\n${chalk.bold('─── Assembled Prompt Preview ───')}\n\n`,
          );
          for (const part of parts) {
            process.stderr.write(
              `${chalk.cyan(`[${part.label}]`)} ${chalk.dim(`(${part.content.length} chars)`)}\n`,
            );
            process.stderr.write(
              `${chalk.dim(part.content.slice(0, 200))}${part.content.length > 200 ? chalk.dim('...') : ''}\n\n`,
            );
          }
          process.stderr.write(`${chalk.bold('─── Stats ───')}\n`);
          process.stderr.write(
            `  Total length: ${totalLength.toLocaleString()} chars\n`,
          );
          process.stderr.write(
            `  Parts: ${parts.map((p) => p.label.toLowerCase()).join(' + ')}\n`,
          );
          process.stderr.write(`  Model: ${model}\n`);
          process.stderr.write(`  Timeout: ${config.timeout}s\n\n`);

          exitWithEnvelope(
            formatSuccess('run', {
              slug,
              dryRun: true,
              totalLength,
              parts: parts.map((p) => p.label),
              model,
              timeout: config.timeout,
            }),
          );
          return;
        }

        // Pre-flight: check GH_TOKEN (after dry-run — dry-run doesn't need it)
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
          pretty?.cleanup();
          process.stderr.write(chalk.dim('\n  Interrupted.\n'));
          process.exit(130);
        };
        process.on('SIGINT', sigintHandler);

        try {
          const onEvent = pretty
            ? (e: import('../../adapter/events.js').AgentEvent) =>
                pretty.handleEvent(e)
            : isTTY
              ? displayEvent
              : undefined;
          const result = await runAgent(
            adapter,
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
