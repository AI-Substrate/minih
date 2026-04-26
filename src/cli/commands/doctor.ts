/**
 * minih doctor — validate the entire agents directory.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import chalk from 'chalk';
import type { Command } from 'commander';
import {
  hasOutsideMd,
  OutsideAgentsDirError,
  outsideMdPath,
  parseFrontmatter,
} from '../../runner/index.js';
import {
  ErrorCodes,
  exitWithEnvelope,
  formatError,
  formatSuccess,
} from '../output.js';

interface CheckResult {
  check: string;
  status: 'pass' | 'warning' | 'fail' | 'skip';
  message?: string;
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Validate all agents and harness structure')
    .option('--strict', 'Treat warnings as errors')
    .action((opts: { strict?: boolean }) => {
      const agentsDir = program.opts().agentsDir ?? 'agents';
      const resolvedDir = path.resolve(agentsDir);

      if (!fs.existsSync(resolvedDir)) {
        exitWithEnvelope(
          formatError(
            'doctor',
            ErrorCodes.INVALID_ARGS,
            `Agents directory not found: ${resolvedDir}`,
          ),
        );
        return;
      }

      const agentResults: Array<{ slug: string; checks: CheckResult[] }> = [];

      // Scan all directories (including ones listAgents might skip)
      const entries = fs.readdirSync(resolvedDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('_')) continue;

        const dir = path.join(resolvedDir, entry.name);
        const promptPath = path.join(dir, 'prompt.md');
        const checks: CheckResult[] = [];

        // Check prompt.md exists
        if (!fs.existsSync(promptPath)) {
          checks.push({
            check: 'prompt.md',
            status: 'fail',
            message: 'No prompt.md found',
          });
          agentResults.push({ slug: entry.name, checks });
          continue;
        }
        checks.push({ check: 'prompt.md', status: 'pass' });

        // Check frontmatter
        const content = fs.readFileSync(promptPath, 'utf-8');
        const { description, coordination } = parseFrontmatter(content);
        if (!description.trim()) {
          checks.push({
            check: 'frontmatter',
            status: 'warning',
            message: 'Missing frontmatter with description',
          });
        } else {
          checks.push({
            check: 'frontmatter',
            status: 'pass',
            message: description,
          });
        }

        // Check output-schema.json
        const schemaPath = path.join(dir, 'output-schema.json');
        if (fs.existsSync(schemaPath)) {
          try {
            const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
            const ajv = createRefAwareAjv();
            ajv.compile(schema);
            checks.push({ check: 'output-schema', status: 'pass' });

            // Check for retrospective in schema
            const hasRetro =
              schema.required?.includes('retrospective') ||
              schema.properties?.retrospective;
            checks.push({
              check: 'retrospective',
              status: hasRetro ? 'pass' : 'warning',
              message: hasRetro
                ? undefined
                : 'retrospective not in output schema (system validation still enforces it)',
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            checks.push({
              check: 'output-schema',
              status: 'fail',
              message: `Schema error: ${msg}`,
            });
          }
        } else {
          checks.push({
            check: 'output-schema',
            status: 'skip',
            message: 'No output-schema.json',
          });
        }

        // Check input-schema.json
        const inputPath = path.join(dir, 'input-schema.json');
        if (fs.existsSync(inputPath)) {
          try {
            const schema = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
            const ajv = createRefAwareAjv();
            ajv.compile(schema);
            checks.push({ check: 'input-schema', status: 'pass' });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            checks.push({
              check: 'input-schema',
              status: 'fail',
              message: `Schema error: ${msg}`,
            });
          }
        }

        // Check instructions
        const instrPath = path.join(dir, 'instructions.md');
        if (fs.existsSync(instrPath)) {
          checks.push({ check: 'instructions', status: 'pass' });
        }

        checks.push(
          ...checkOutsideContract(
            entry.name,
            resolvedDir,
            promptPath,
            coordination.enabled,
          ),
        );

        agentResults.push({ slug: entry.name, checks });
      }

      // Check preamble
      const preamblePath = path.join(resolvedDir, '_shared', 'preamble.md');
      const preamble = {
        exists: fs.existsSync(preamblePath),
        path: preamblePath,
      };

      // Summarize
      let warnings = 0;
      let errors = 0;
      for (const agent of agentResults) {
        for (const check of agent.checks) {
          if (check.status === 'warning') warnings++;
          if (check.status === 'fail') errors++;
        }
      }
      const healthy = agentResults.filter((a) =>
        a.checks.every((c) => c.status === 'pass' || c.status === 'skip'),
      ).length;

      // TTY display
      if (process.stderr.isTTY) {
        process.stderr.write(
          `\n  ${chalk.bold('Checking agents directory:')} ${chalk.dim(resolvedDir)}\n\n`,
        );

        for (const agent of agentResults) {
          process.stderr.write(`  ${chalk.cyan(agent.slug)}\n`);
          for (const check of agent.checks) {
            const icon =
              check.status === 'pass'
                ? chalk.green('✓')
                : check.status === 'warning'
                  ? chalk.yellow('⚠')
                  : check.status === 'fail'
                    ? chalk.red('✗')
                    : chalk.dim('—');
            const msg = check.message ? ` ${chalk.dim(check.message)}` : '';
            process.stderr.write(`    ${icon} ${check.check}${msg}\n`);
          }
          process.stderr.write('\n');
        }

        if (preamble.exists) {
          process.stderr.write(`  ${chalk.green('✓')} _shared/preamble.md\n\n`);
        } else {
          process.stderr.write(
            `  ${chalk.dim('—')} _shared/preamble.md (not found)\n\n`,
          );
        }

        process.stderr.write(`  ${chalk.bold('─── Results ───')}\n`);
        process.stderr.write(`  Agents:   ${agentResults.length} found\n`);
        process.stderr.write(`  Healthy:  ${healthy}\n`);
        if (warnings > 0)
          process.stderr.write(
            `  Warnings: ${chalk.yellow(String(warnings))}\n`,
          );
        if (errors > 0)
          process.stderr.write(`  Errors:   ${chalk.red(String(errors))}\n`);
        process.stderr.write('\n');
      }

      const hasErrors = errors > 0 || (opts.strict && warnings > 0);
      const status = hasErrors ? 'error' : warnings > 0 ? 'degraded' : 'ok';

      if (hasErrors) {
        exitWithEnvelope(
          formatError(
            'doctor',
            ErrorCodes.AGENT_VALIDATION_FAILED,
            `${errors} errors, ${warnings} warnings found`,
            {
              agents: agentResults,
              preamble,
              summary: {
                total: agentResults.length,
                healthy,
                warnings,
                errors,
              },
            },
          ),
        );
      } else {
        exitWithEnvelope(
          formatSuccess(
            'doctor',
            {
              agents: agentResults,
              preamble,
              summary: {
                total: agentResults.length,
                healthy,
                warnings,
                errors,
              },
            },
            status as 'ok' | 'degraded',
          ),
        );
      }
    });
}

function checkOutsideContract(
  slug: string,
  agentsDir: string,
  promptPath: string,
  coordinationEnabled: boolean,
): CheckResult[] {
  if (!coordinationEnabled) return [];

  let exists: boolean;
  try {
    exists = hasOutsideMd(slug, agentsDir);
  } catch (error) {
    if (error instanceof OutsideAgentsDirError) {
      return [
        {
          check: 'outside.md',
          status: 'fail',
          message: error.message,
        },
      ];
    }
    throw error;
  }
  if (!exists) return [];

  const outsidePath = outsideMdPath(slug, agentsDir);
  const outsideStats = fs.statSync(outsidePath);
  const promptStats = fs.statSync(promptPath);
  const results: CheckResult[] = [{ check: 'outside.md', status: 'pass' }];

  if (outsideStats.mtimeMs < promptStats.mtimeMs) {
    results.push({
      check: 'outside.md-drift',
      status: 'warning',
      message: 'outside.md is older than prompt.md; review the peer contract.',
    });
  }

  if (outsideStats.size > 8 * 1024) {
    results.push({
      check: 'outside.md-size',
      status: 'fail',
      message: `outside.md is ${outsideStats.size} bytes (> 8192 byte limit).`,
    });
  } else if (outsideStats.size > 4 * 1024) {
    results.push({
      check: 'outside.md-size',
      status: 'warning',
      message: `outside.md is ${outsideStats.size} bytes (> 4096 byte warning threshold).`,
    });
  }

  return results;
}

/** Create an AJV instance pre-loaded with minih's published schemas for $ref support. */
function createRefAwareAjv(): InstanceType<typeof Ajv2020> {
  const ajv = new Ajv2020({ allErrors: true });
  const schemasDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'schemas',
  );
  for (const name of ['retrospective.json', 'system-output.json']) {
    const p = path.join(schemasDir, name);
    if (fs.existsSync(p)) {
      try {
        ajv.addSchema(JSON.parse(fs.readFileSync(p, 'utf-8')));
      } catch {
        // Schema might already be loaded or invalid — skip
      }
    }
  }
  return ajv;
}
