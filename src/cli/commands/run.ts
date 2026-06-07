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
import chalk from 'chalk';
import type { Command } from 'commander';
import { buildInsideMcpServerConfig } from '../../mcp/index.js';
import type { AgentRunConfig } from '../../runner/index.js';
import {
  buildInsidePreamble,
  coordinationRunLocation,
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
  ErrorCodes,
  exitWithEnvelope,
  formatError,
  formatSuccess,
} from '../output.js';
import { parseParamFlags } from '../param-parser.js';
import { assertOutsideContext } from '../preaction-context.js';
import { hasSkillErrors, resolveSkillsConfig } from '../skills.js';
import { createSdkRuntime } from './sdk-runtime.js';

/**
 * Format a typed param value for display in preflight banner / paramsHint.
 *
 * Strings render as themselves (no surrounding quotes — preflight is plain
 * text). Anything else (number, boolean, object, array, null) renders via
 * `JSON.stringify` so the user sees a faithful representation of what the
 * agent's input-schema receives. Plan 019 FX001.
 */
function formatParamValue(v: unknown): string {
  if (typeof v === 'string') return v;
  return JSON.stringify(v) ?? String(v);
}

export function registerRunCommand(program: Command): void {
  program
    .command('run <slug>')
    .description('Execute an agent')
    .hook('preAction', () => {
      assertOutsideContext({
        commandName: 'run',
        alternatives: [
          'Use the inbox/state MCP tools from inside the session.',
          'From an outside shell, use `minih outside inbox send <slug>` to communicate with the running agent.',
        ],
      });
    })
    .option(
      '-m, --model <model>',
      'Model to use (e.g., gpt-5.4, claude-sonnet-4)',
    )
    .option(
      '-r, --reasoning <effort>',
      'Reasoning effort (low, medium, high, xhigh)',
    )
    .option(
      '--no-reasoning',
      "Clear any reasoning effort default from the agent's frontmatter (use when picking a model that doesn't support reasoning)",
    )
    .option(
      '-t, --timeout <seconds>',
      'Timeout in seconds (default: agent frontmatter or 900)',
    )
    .option(
      '-p, --param <key=value>',
      'Input parameter (repeatable). Values are JSON-parsed when possible: ' +
        '-p count=3 yields integer 3; -p enabled=true yields boolean true; ' +
        "-p obj='{\"k\":1}' yields an object. Strings that aren't valid " +
        'JSON pass through as-is (-p name=alice). To force a literal ' +
        'string of digits or true/false/null, use quoted JSON: -p val=\'"3"\'.',
      (val: string, acc: string[]) => {
        acc.push(val);
        return acc;
      },
      [] as string[],
    )
    .option('--dry-run', 'Preview assembled prompt without executing')
    .option('--verbose', 'Show all events with timestamps (verbose mode)')
    .option(
      '--human',
      'Mount the live human-view TUI to stderr (plan 009; mutually-exclusive with --verbose)',
    )
    .option('--mcp-config <path>', 'MCP config file with mcpServers (JSON)')
    .option(
      '--skill-source <alias-or-path>',
      'Skill source alias/path to load (repeatable; try .agents, global:agents, global:claude)',
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
    .option('--skills-debug', 'Print resolved skills config before starting')
    // Plan 018 R2 — per-run permission overrides
    .option(
      '--permissions <preset>',
      'Override the resolved preset for this run (yolo|trusted|restricted|read-only|network|build-only)',
    )
    .option(
      '--allowed-roots <paths>',
      'Extend allowedRoots with comma-separated paths (mode: extend)',
    )
    .option(
      '--allowed-roots-only <paths>',
      'Replace allowedRoots with comma-separated paths (mode: replace)',
    )
    .option('--strict-fs', 'Opt into Layer-(b) FS sandbox (Phase 6 stretch)')
    .option(
      '--dry-run-permissions',
      'Resolve and print policy without executing the agent',
    )
    .option(
      '--allow-coord-write-deny',
      'Per-invocation opt-out for the FX008 boot precondition. Lets a coordinated agent run even when its policy denies write — operator acknowledges the canonical farewell envelope (output/report.json) cannot be persisted. Emits a stderr deprecation banner on every use. No env-var fallback (intentional).',
    )
    .addHelpText(
      'after',
      '\nTip: For coordinated agents, run `minih outside context <slug>` first to read the outside-side contract.\n' +
        '\nAfter the run completes, `minih harvest <slug>` captures the retro into `docs/retros/`.\n' +
        '\nSkills: configure `.minih.json` or use `--skill-source .agents --skill <name>`; inspect with `minih skills discover`.\n' +
        '\nPermission troubleshooting: see `docs/how/permissions.md` and `minih agent permissions list-available`.\n',
    )
    .action(
      async (
        slug: string,
        opts: {
          model?: string;
          /** string when --reasoning <effort>; false when --no-reasoning; undefined otherwise */
          reasoning?: string | false;
          timeout?: string;
          param?: string[];
          dryRun?: boolean;
          verbose?: boolean;
          human?: boolean;
          mcpConfig?: string;
          skillSource?: string[];
          skill?: string[];
          disableSkill?: string[];
          skills?: boolean;
          skillsDebug?: boolean;
          permissions?: string;
          allowedRoots?: string;
          allowedRootsOnly?: string;
          strictFs?: boolean;
          dryRunPermissions?: boolean;
          allowCoordWriteDeny?: boolean;
        },
      ) => {
        const agentsDir = program.opts().agentsDir ?? 'agents';

        // Plan 009 Phase 2 — `--human` and `--verbose` are mutually exclusive.
        if (opts.human && opts.verbose) {
          exitWithEnvelope(
            formatError(
              'run',
              ErrorCodes.INVALID_ARGS,
              '--human and --verbose are mutually exclusive.',
              { provided: ['--human', '--verbose'] },
            ),
          );
        }

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

        // Parse --param key=value pairs (auto-coerces JSON values per FX001).
        const { params, invalidEntry } = parseParamFlags(opts.param ?? []);
        if (invalidEntry !== null) {
          exitWithEnvelope(
            formatError(
              'run',
              ErrorCodes.INVALID_ARGS,
              `Invalid --param format: "${invalidEntry}". Expected key=value.`,
            ),
          );
        }

        const DEFAULT_MODEL = 'claude-opus-4.6';
        const model =
          opts.model ??
          definition.model ??
          process.env.MINIH_DEFAULT_MODEL ??
          DEFAULT_MODEL;
        // Reasoning resolution:
        //   --reasoning <effort>  → use it
        //   --no-reasoning        → opts.reasoning === false → clear default
        //   (neither)             → fall back to frontmatter
        const reasoningEffort: AgentRunConfig['reasoningEffort'] | undefined =
          opts.reasoning === false
            ? undefined
            : ((opts.reasoning ??
                definition.reasoning) as AgentRunConfig['reasoningEffort']);

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

        // Plan 009 Phase 2 — `--human` mounts an Ink TUI to stderr instead of
        // pretty/verbose. Pretty mode is suppressed; the renderer takes over.
        const humanHandle: {
          ref: {
            unmount(): void;
            updateBridge(
              b: import('../human/input-bridge.js').InputBridge,
            ): void;
          } | null;
        } = { ref: null };

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
              'run',
              ErrorCodes.SKILL_NOT_FOUND,
              'Could not resolve requested skills.',
              { diagnostics: resolvedSkills.diagnostics },
            ),
          );
        }

        // Plan 018 R2 — assemble per-run permission overrides from CLI flags.
        let permissionsOverride:
          | AgentRunConfig['permissionsOverride']
          | undefined;
        if (
          opts.permissions ||
          opts.allowedRoots ||
          opts.allowedRootsOnly ||
          opts.strictFs ||
          opts.allowCoordWriteDeny
        ) {
          permissionsOverride = {};
          if (opts.permissions) {
            const validPresets = [
              'yolo',
              'trusted',
              'restricted',
              'read-only',
              'network',
              'build-only',
            ];
            if (!validPresets.includes(opts.permissions)) {
              exitWithEnvelope(
                formatError(
                  'run',
                  ErrorCodes.PERMISSION_PRESET_UNKNOWN,
                  `Unknown preset "${opts.permissions}". Valid: ${validPresets.join(', ')}`,
                ),
              );
              return;
            }
            permissionsOverride.preset = opts.permissions as NonNullable<
              AgentRunConfig['permissionsOverride']
            >['preset'];
          }
          if (opts.allowedRoots) {
            permissionsOverride.allowedRoots = {
              mode: 'extend',
              roots: opts.allowedRoots.split(',').map((s) => s.trim()),
            };
          } else if (opts.allowedRootsOnly) {
            permissionsOverride.allowedRoots = {
              mode: 'replace',
              roots: opts.allowedRootsOnly.split(',').map((s) => s.trim()),
            };
          }
          if (opts.strictFs) {
            permissionsOverride.strictFs = true;
          }
          if (opts.allowCoordWriteDeny) {
            permissionsOverride.allowCoordWriteDeny = true;
          }
        }

        // Plan 018 R2 — `--dry-run-permissions` prints the resolved policy
        // without executing the agent.
        if (opts.dryRunPermissions) {
          try {
            const { compilePermissionPolicy } = await import(
              '../../runner/index.js'
            );
            const resolved = compilePermissionPolicy({
              frontmatter: permissionsOverride?.preset
                ? { preset: permissionsOverride.preset }
                : definition.permissions,
              releaseDefault: { preset: 'yolo' },
              cli: permissionsOverride?.allowedRoots,
              cwd: process.cwd(),
            });
            exitWithEnvelope(
              formatSuccess('run', {
                dryRunPermissions: true,
                slug,
                resolved,
              }),
            );
            return;
          } catch (err) {
            exitWithEnvelope(
              formatError(
                'run',
                ErrorCodes.PERMISSIONS_FRONTMATTER_INVALID,
                `Could not resolve permissions: ${(err as Error).message}`,
              ),
            );
            return;
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
          ...(permissionsOverride && { permissionsOverride }),
          insideMcpServerFactory: ({ runId, runDir, agentSlug, agentsDir }) =>
            buildInsideMcpServerConfig({
              runId,
              runDir,
              agentSlug,
              agentsDir,
            }),
          reservedMcpToolPrefixes: ['inbox_', 'state_'],
          ...(mcpServers && { mcpServers }),
          ...(resolvedSkills.skillDirectories && {
            skillDirectories: resolvedSkills.skillDirectories,
          }),
          ...(resolvedSkills.disabledSkills && {
            disabledSkills: resolvedSkills.disabledSkills,
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
                const { buildHumanViewModel } = await import(
                  '../../runner/index.js'
                );

                const feed = await createRunFeed({
                  runDir: ctx.runDir,
                  onUpdate: (model) => {
                    pushHumanModel(model);
                  },
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

                // FX002-5 + Ctrl-C bug: unmount + setImmediate guard so Ink's
                // terminal-restore side effects flush before process.exit. Used
                // for both signals AND in-TUI Ctrl-C (raw mode swallows SIGINT).
                const exitState = { exited: false };
                const handleRef: {
                  current: { unmount(): void } | null;
                } = { current: null };
                const onSig = (code: number): void => {
                  if (exitState.exited) return;
                  exitState.exited = true;
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

        // Display setup: pretty (default), verbose (--verbose / non-TTY), or
        // suppressed entirely when --human owns the renderer.
        const isTTY = process.stderr.isTTY;
        const useVerbose = opts.verbose || !isTTY;
        const pretty = opts.human || useVerbose ? null : new PrettyDisplay();

        if (isTTY && !opts.human) {
          displayHeader(slug, '(starting...)', model);
          displayPreflight('GH_TOKEN', true);
          displayPreflight('Agent definition', true, definition.dir);
          if (resolvedSkills.enabled) {
            displayPreflight(
              'Skills',
              !hasSkillErrors(resolvedSkills),
              `${resolvedSkills.skillDirectories?.length ?? 0} directories`,
            );
          }
          if (config.params) {
            for (const [k, v] of Object.entries(config.params)) {
              displayPreflight(`param:${k}`, true, formatParamValue(v));
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

          const outputHint =
            'Write your final JSON report to: <run-dir>/output/report.json';
          const paramsHint = config.params
            ? `## Input Parameters\n\n${Object.entries(config.params)
                .map(([k, v]) => `${k}: ${formatParamValue(v)}`)
                .join('\n')}`
            : null;
          const assembledPrompt = buildInsidePreamble({
            definition,
            runId: '(dry-run)',
            preamble: preambleContent,
            instructions,
            outputHint,
            paramsHint,
            userPrompt: promptBody,
            systemOutputInstructions: SYSTEM_OUTPUT_INSTRUCTIONS,
          });
          const parts = [
            preambleContent && 'PREAMBLE',
            definition.coordination?.enabled && 'COORDINATION',
            'OUTPUT HINT',
            paramsHint && 'INPUT PARAMS',
            'PROMPT',
            instructions && 'INSTRUCTIONS',
            'SYSTEM REQUIREMENTS',
          ].filter(Boolean) as string[];
          const totalLength = assembledPrompt.length;

          process.stderr.write(
            `\n${chalk.bold('─── Assembled Prompt Preview ───')}\n\n`,
          );
          process.stderr.write(`${assembledPrompt}\n\n`);
          process.stderr.write(`${chalk.bold('─── Stats ───')}\n`);
          process.stderr.write(
            `  Total length: ${totalLength.toLocaleString()} chars\n`,
          );
          process.stderr.write(
            `  Parts: ${parts.map((p) => p.toLowerCase()).join(' + ')}\n`,
          );
          process.stderr.write(`  Model: ${model}\n`);
          process.stderr.write(`  Timeout: ${config.timeout}s\n\n`);

          exitWithEnvelope(
            formatSuccess('run', {
              slug,
              dryRun: true,
              prompt: assembledPrompt,
              totalLength,
              parts,
              model,
              timeout: config.timeout,
            }),
          );
          return;
        }

        const runtime = await createSdkRuntime('run', () => pretty?.cleanup());

        // Pre-flight: validate model + reasoning against copilot-sdk's
        // model registry so unsupported combinations fail with a clear CLI
        // error before we spin up a session and write a junk run folder.
        const modelCheck = await runtime.validateModelConfig({
          model,
          reasoningEffort,
        });
        if (!modelCheck.ok) {
          pretty?.cleanup();
          runtime.cleanup();
          exitWithEnvelope(
            formatError(
              'run',
              ErrorCodes.AGENT_MODEL_INVALID,
              modelCheck.message,
              modelCheck.details,
            ),
          );
        }

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
          // Plan 009 Phase 2 — when --human owns the renderer, the live TUI
          // already shows the final state; don't double-print the pretty summary.
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
            // FX008-4 — route permission denials to dedicated error codes.
            // `permissionError.kind === 'coord-write-deny'` → E205 (FX008
            // boot precondition). Any other kind (shell/write/mcp/read/...)
            // → E200 (the canonical permission-denied code allocated in
            // Plan 018 R1; previously unwired). Falls through to E120 for
            // non-permission failures and E123 for timeouts.
            const permissionKind = result.metadata.permissionError?.kind;
            let errorCode: string = ErrorCodes.AGENT_EXECUTION_FAILED;
            if (result.metadata.result === 'timeout') {
              errorCode = ErrorCodes.AGENT_TIMEOUT;
            } else if (permissionKind === 'coord-write-deny') {
              errorCode = ErrorCodes.COORDINATION_WRITE_DENIED;
            } else if (permissionKind) {
              errorCode = ErrorCodes.PERMISSION_DENIED;
            }
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
