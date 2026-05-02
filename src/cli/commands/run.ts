/**
 * minih run — composition root. Dynamic SDK import.
 *
 * Only CLI command that touches @github/copilot-sdk (alongside resume).
 * DYK #1: try/catch on dynamic import → actionable error if SDK missing.
 * DYK #1 (session): client.stop() in finally, SIGINT for instant Ctrl+C kill.
 * Workshop 005: SDK workingDirectory = runDir for session isolation.
 * DYK #2 (003): SDK wiring extracted to sdk-runtime.ts, shared with resume.ts.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { context } from '@opentelemetry/api';
import chalk from 'chalk';
import type { Command } from 'commander';
import type { AgentRunConfig } from '../../runner/index.js';
import {
  displayEvent,
  displayHeader,
  displayPreflight,
  displaySummary,
  listAgents,
  loadMcpConfig,
  PrettyDisplay,
  parseFrontmatter,
  resolveAgent,
  runAgent,
  SYSTEM_OUTPUT_INSTRUCTIONS,
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
    .option(
      '-t, --timeout <seconds>',
      'Timeout in seconds (default: agent frontmatter or 900)',
    )
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
    .option('--mcp-config <path>', 'MCP config file with mcpServers (JSON)')
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
          mcpConfig?: string;
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
          opts.model ??
          definition.model ??
          process.env.MINIH_DEFAULT_MODEL ??
          DEFAULT_MODEL;
        const reasoningEffort = (opts.reasoning ??
          definition.reasoning) as AgentRunConfig['reasoningEffort'];

        const DEFAULT_TIMEOUT = 900; // 15 minutes

        // MCP config: --mcp-config file (explicit) or auto-discovery via configDir (DYK #1: mutually exclusive)
        let mcpServers: Record<string, unknown> | undefined;
        if (opts.mcpConfig) {
          try {
            mcpServers = loadMcpConfig(path.resolve(opts.mcpConfig));
          } catch (err) {
            exitWithEnvelope(
              formatError(
                'run',
                ErrorCodes.INVALID_ARGS,
                err instanceof Error ? err.message : String(err),
              ),
            );
          }
        }

        const config: AgentRunConfig = {
          slug,
          model,
          reasoningEffort,
          timeout: opts.timeout
            ? Number.parseInt(opts.timeout, 10)
            : (definition.timeout ?? DEFAULT_TIMEOUT),
          cwd: process.cwd(),
          params: Object.keys(params).length > 0 ? params : undefined,
          ...(mcpServers && { mcpServers }),
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

        const runtime = await createSdkRuntime('run', () => pretty?.cleanup());

        try {
          const log = createLogger('cli.run');
          log.info(`Command started: run ${slug}`, {
            'command.name': 'run',
            'agent.slug': slug,
            model,
          });

          // Set baggage for automatic propagation to all child spans (DD5)
          const baggageCtx = setBaggage({
            'minih.agent.slug': slug,
            'minih.model': model,
          });

          await context.with(baggageCtx, async () => {
            await withSpan(
              'minih.cli.command',
              async (rootSpan) => {
                rootSpan.setAttribute('command.name', 'run');
                rootSpan.setAttribute('agent.slug', slug);
                rootSpan.setAttribute('model', model);

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
                rootSpan.setAttribute(
                  'validated',
                  result.metadata.validated ?? false,
                );

                log.info(`Command completed: run ${slug}`, {
                  'command.name': 'run',
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
                    formatError('run', errorCode, result.agentResult.output, {
                      runDir: result.runDir,
                      metadata: result.metadata,
                    }),
                  );
                  process.exitCode = 1;
                } else {
                  printEnvelope(
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
                        ...(result.metadata.velocity && {
                          velocity: result.metadata.velocity,
                        }),
                        ...(result.parsedReport && {
                          summary: result.parsedReport.summary,
                          magicWand: result.parsedReport.magicWand,
                          magicWandTarget: result.parsedReport.magicWandTarget,
                          difficulties: result.parsedReport.difficulties,
                        }),
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
          exitWithEnvelope(
            formatError('run', ErrorCodes.AGENT_EXECUTION_FAILED, msg),
          );
        } finally {
          runtime.cleanup();
        }
      },
    );
}
