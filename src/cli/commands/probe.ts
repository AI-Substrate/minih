/**
 * `minih probe` — Plan 018 R2 (T-R2.13).
 *
 * Workshop 004 § Q5+Q8. Orchestrator + aggregator: runs N parallel
 * scenarios from `agents/permission-prober/scenarios.json` and
 * cross-references each agent's self-reported outcome against the run's
 * events.ndjson + run.json (truth).
 *
 * The PROBER is *one agent, many scenarios*. Each scenario is one run;
 * the orchestrator fires them in parallel and aggregates verdicts.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import {
  aggregateReport,
  buildMatrix,
  type ProbeMatrix,
  type ScenarioDefinition,
} from '../../runner/index.js';
import {
  ErrorCodes,
  exitWithEnvelope,
  formatError,
  formatSuccess,
} from '../output.js';

const probeFileDir = path.dirname(fileURLToPath(import.meta.url));

interface ScenariosFile {
  version: string;
  scenarios: Record<string, ScenarioDefinition>;
}

export function registerProbeCommand(program: Command): void {
  program
    .command('probe')
    .description(
      'Fire the permission-prober agent across one or more scenarios and verdict the matrix. Plan 018 workshop 004 (security validation).',
    )
    .option(
      '--matrix <kind>',
      "Run a named matrix subset: 'all' (full 10-scenario matrix), 'core' (4 baseline scenarios)",
    )
    .option(
      '--scenario <name>',
      'Run exactly one scenario by name (key in scenarios.json)',
    )
    .option(
      '--ci',
      'CI mode: structured JSON envelope; non-zero exit on any FAIL/UNTRUSTWORTHY',
    )
    .option(
      '--scenarios-file <path>',
      'Override scenarios.json path (default: agents/permission-prober/scenarios.json)',
    )
    .option(
      '--max-parallel <n>',
      'Max concurrent prober runs (default: 4)',
      '4',
    )
    .action(
      async (opts: {
        matrix?: string;
        scenario?: string;
        ci?: boolean;
        scenariosFile?: string;
        maxParallel?: string;
      }) => {
        const agentsDir = program.opts().agentsDir ?? 'agents';
        const scenariosPath =
          opts.scenariosFile ??
          path.join(agentsDir, 'permission-prober', 'scenarios.json');

        if (!fs.existsSync(scenariosPath)) {
          exitWithEnvelope(
            formatError(
              'probe',
              ErrorCodes.AGENT_NOT_FOUND,
              `scenarios.json not found at ${scenariosPath}. Install the permission-prober pack first: \`minih agent install permission-prober\``,
            ),
          );
          return;
        }

        let scenariosFile: ScenariosFile;
        try {
          scenariosFile = JSON.parse(fs.readFileSync(scenariosPath, 'utf-8'));
        } catch (err) {
          exitWithEnvelope(
            formatError(
              'probe',
              ErrorCodes.INVALID_ARGS,
              `Could not parse scenarios.json: ${(err as Error).message}`,
            ),
          );
          return;
        }

        // Pick targets
        const allKeys = Object.keys(scenariosFile.scenarios);
        let targets: string[];
        if (opts.scenario) {
          if (!scenariosFile.scenarios[opts.scenario]) {
            exitWithEnvelope(
              formatError(
                'probe',
                ErrorCodes.INVALID_ARGS,
                `Unknown scenario "${opts.scenario}". Available: ${allKeys.join(', ')}`,
              ),
            );
            return;
          }
          targets = [opts.scenario];
        } else if (opts.matrix === 'all') {
          targets = allKeys;
        } else if (opts.matrix === 'core') {
          targets = allKeys.filter((k) =>
            [
              'yolo-baseline',
              'restricted-default',
              'read-only',
              'network',
            ].includes(k),
          );
        } else {
          exitWithEnvelope(
            formatError(
              'probe',
              ErrorCodes.INVALID_ARGS,
              'Specify --scenario <name> or --matrix all|core',
            ),
          );
          return;
        }

        const maxParallel = Number.parseInt(opts.maxParallel ?? '4', 10);
        if (Number.isNaN(maxParallel) || maxParallel < 1 || maxParallel > 32) {
          exitWithEnvelope(
            formatError(
              'probe',
              ErrorCodes.INVALID_ARGS,
              `--max-parallel must be 1-32; got ${opts.maxParallel}`,
            ),
          );
          return;
        }

        if (process.stderr.isTTY && !opts.ci) {
          process.stderr.write(
            `\n🔍 minih probe — ${targets.length} scenario(s), max ${maxParallel} parallel\n\n`,
          );
        }

        const results = await runMatrix(
          targets,
          scenariosFile,
          agentsDir,
          maxParallel,
          { quiet: !!opts.ci },
        );

        const matrix = buildMatrix(results);

        if (process.stderr.isTTY && !opts.ci) {
          renderMatrixHuman(matrix);
        }

        const success =
          matrix.failed === 0 && matrix.untrustworthy === 0;

        if (success) {
          exitWithEnvelope(formatSuccess('probe', { matrix }));
        } else {
          // Non-zero exit but write the matrix; --ci flag escalates to exit 1
          exitWithEnvelope(
            formatError(
              'probe',
              ErrorCodes.AGENT_VALIDATION_FAILED,
              `${matrix.failed} FAIL, ${matrix.untrustworthy} UNTRUSTWORTHY of ${matrix.totalScenarios}`,
              { matrix },
            ),
          );
        }
      },
    );
}

async function runMatrix(
  targets: string[],
  scenariosFile: ScenariosFile,
  agentsDir: string,
  maxParallel: number,
  opts: { quiet: boolean },
): Promise<ReturnType<typeof aggregateReport>[]> {
  const results: ReturnType<typeof aggregateReport>[] = [];
  for (let i = 0; i < targets.length; i += maxParallel) {
    const batch = targets.slice(i, i + maxParallel);
    const batchResults = await Promise.all(
      batch.map((scenarioName) =>
        runOneScenario(scenarioName, scenariosFile, agentsDir, opts),
      ),
    );
    results.push(...batchResults);
  }
  return results;
}

async function runOneScenario(
  scenarioName: string,
  scenariosFile: ScenariosFile,
  agentsDir: string,
  opts: { quiet: boolean },
): Promise<ReturnType<typeof aggregateReport>> {
  const scenarioDef = scenariosFile.scenarios[scenarioName];
  const nonce = crypto.randomBytes(8).toString('hex');

  if (!opts.quiet) {
    process.stderr.write(`  ▶ ${scenarioName} (nonce=${nonce})\n`);
  }

  // Build CLI args: minih run permission-prober --param scenario=<name>
  // --param nonce=<nonce> --permissions <preset> [--allowed-roots-only <p>]
  const args = [
    'run',
    'permission-prober',
    '--param',
    `scenario=${scenarioName}`,
    '--param',
    `nonce=${nonce}`,
    '--timeout',
    '60',
  ];
  if (scenarioDef.permissionsOverride) {
    args.push('--permissions', scenarioDef.permissionsOverride);
  }
  if (scenarioDef.allowedRootsOnly) {
    args.push('--allowed-roots-only', scenarioDef.allowedRootsOnly);
  }

  const env = { ...process.env };
  if (scenarioDef.envOverride) {
    env.MINIH_PERMISSIONS_DEFAULT = scenarioDef.envOverride;
  }

  // Spawn the run synchronously in a subprocess. We rely on `minih run`'s
  // exit semantics; the run dir + report.json are read post-mortem by the
  // aggregator.
  const minihBin = path.resolve(probeFileDir, '..', 'index.js');
  const minihPath = fs.existsSync(minihBin) ? minihBin : 'minih';

  const result = spawnSync(
    process.execPath,
    [minihPath, ...args, '--agents-dir', agentsDir],
    {
      env,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 90 * 1000,
    },
  );

  // Discover the run dir from stdout JSON envelope
  let runId = 'unknown';
  let runDir = '';
  try {
    const lastJsonLine = (result.stdout ?? '')
      .trim()
      .split('\n')
      .reverse()
      .find((l) => l.startsWith('{'));
    if (lastJsonLine) {
      const env = JSON.parse(lastJsonLine);
      runId = env.data?.runId ?? env.data?.metadata?.runId ?? 'unknown';
      runDir =
        env.data?.runDir ?? env.data?.metadata?.runDir ?? '';
    }
  } catch {
    // ignore
  }
  if (!runDir) {
    runDir = path.join(agentsDir, 'permission-prober', 'runs', runId);
  }

  return aggregateReport({
    runDir,
    runId,
    scenario: scenarioName,
    scenarioDef,
    expectedNonce: nonce,
  });
}

function renderMatrixHuman(matrix: ProbeMatrix): void {
  process.stderr.write(`\n📊 Probe matrix verdict\n`);
  process.stderr.write(`  PASS: ${matrix.passed}/${matrix.totalScenarios}\n`);
  process.stderr.write(`  FAIL: ${matrix.failed}\n`);
  process.stderr.write(`  UNTRUSTWORTHY: ${matrix.untrustworthy}\n\n`);
  for (const r of matrix.reports) {
    const glyph =
      r.verdict === 'PASS' ? '✅' : r.verdict === 'FAIL' ? '❌' : '⚠️';
    process.stderr.write(`  ${glyph} ${r.scenario}: ${r.message}\n`);
  }
  process.stderr.write('\n');
}
