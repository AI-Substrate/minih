/**
 * minih tail <slug> — follow a running agent's event stream.
 *
 * Not an envelope command — interactive, writes directly to stderr.
 * DYK #2: Polls events.ndjson every 200ms, exits on completed.json.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import chalk from 'chalk';
import { type Command, InvalidArgumentError } from 'commander';
import {
  displayEvent,
  listActiveRunCandidates,
  MultipleActiveRunsError,
  resolveAgent,
  resolveRunWithDiagnostics,
  validateSlug,
} from '../../runner/index.js';
import { assertOutsideContext } from '../preaction-context.js';

const TAIL_READ_CHUNK_SIZE = 64 * 1024;

export function registerTailCommand(program: Command): void {
  program
    .command('tail <slug>')
    .description("Follow or snapshot a running agent's event stream")
    .hook('preAction', () => {
      assertOutsideContext({
        commandName: 'tail',
        alternatives: [
          'Use the current session transcript or MCP tool results from inside the session.',
          'Run `minih status <slug>` or `minih tail <slug>` from an outside shell.',
        ],
      });
    })
    .option('--run <runId>', 'Specific run ID (default: latest)')
    .option(
      '--latest',
      'Explicitly choose the newest active run when multiple active runs exist',
    )
    .option(
      '--lines <count>',
      'Number of recent events to show before following, or in snapshot mode',
      parseLineCount,
      20,
    )
    .option(
      '--snapshot',
      'Print the bounded recent events and completion summary, then exit',
    )
    .action(
      (
        slug: string,
        opts: {
          run?: string;
          latest?: boolean;
          lines: number;
          snapshot?: boolean;
        },
      ) => {
        const agentsDir = program.opts().agentsDir ?? 'agents';

        const slugError = validateSlug(slug);
        if (slugError) {
          process.stderr.write(chalk.red(`Error: ${slugError}\n`));
          process.exit(1);
        }

        const definition = resolveAgent(slug, agentsDir);
        if (!definition) {
          process.stderr.write(chalk.red(`Agent "${slug}" not found.\n`));
          process.exit(1);
        }

        void resolveTailTarget({
          slug,
          runId: opts.run,
          latest: opts.latest,
          agentsDir,
        })
          .then((resolved) => {
            if (!resolved) {
              process.stderr.write(chalk.red(`No runs found for "${slug}".\n`));
              process.exit(1);
            }
            tailResolvedRun(slug, resolved.runId, resolved.runDir, opts);
          })
          .catch((err: unknown) => {
            if (err instanceof MultipleActiveRunsError) {
              process.stderr.write(
                chalk.red(
                  `Multiple active runs found for "${slug}". Pass --run <runId> or inspect with minih runs list --active --slug ${slug}.\n`,
                ),
              );
              for (const candidate of err.candidates) {
                process.stderr.write(chalk.dim(`  ${candidate.runId}\n`));
              }
              process.exit(1);
            }
            throw err;
          });
      },
    );
}

async function resolveTailTarget(opts: {
  slug: string;
  runId?: string;
  latest?: boolean;
  agentsDir: string;
}): Promise<{ runId: string; runDir: string } | null> {
  if (opts.latest && !opts.runId) {
    const active = await listActiveRunCandidates({
      slug: opts.slug,
      mode: { kind: 'latest-active' },
      agentsDir: opts.agentsDir,
    });
    const newest = active.candidates.sort((a, b) =>
      b.runId.localeCompare(a.runId),
    )[0];
    if (newest) {
      const resolved = await resolveRunWithDiagnostics({
        slug: opts.slug,
        mode: { kind: 'by-id', runId: newest.runId },
        agentsDir: opts.agentsDir,
      });
      return resolved.resolved
        ? { runId: resolved.resolved.runId, runDir: resolved.resolved.runDir }
        : null;
    }
  }
  const resolved = await resolveRunWithDiagnostics({
    slug: opts.slug,
    mode: opts.runId
      ? { kind: 'by-id', runId: opts.runId }
      : { kind: 'latest-any' },
    agentsDir: opts.agentsDir,
  });
  return resolved.resolved
    ? { runId: resolved.resolved.runId, runDir: resolved.resolved.runDir }
    : null;
}

function tailResolvedRun(
  slug: string,
  runId: string,
  runDir: string,
  opts: { lines: number; snapshot?: boolean },
): void {
  const eventsPath = path.join(runDir, 'events.ndjson');
  const completedPath = path.join(runDir, 'completed.json');

  process.stderr.write(
    `\n  ${chalk.bold('Tailing:')} ${chalk.cyan(slug)} / ${chalk.dim(runId)}\n`,
  );
  process.stderr.write(
    `  ${chalk.bold('Events:')}  ${chalk.dim(eventsPath)}\n`,
  );
  if (opts.snapshot) {
    process.stderr.write(`  ${chalk.bold('Mode:')}    snapshot\n\n`);
  } else {
    process.stderr.write(`  Press ${chalk.bold('Ctrl+C')} to stop\n\n`);
  }

  let bytesRead = 0;
  const existingEvents = readRecentEventLines(eventsPath, opts.lines);
  bytesRead = existingEvents.bytesRead;
  if (existingEvents.hasEarlier) {
    const omitted =
      existingEvents.skippedLineCount === undefined
        ? 'earlier events omitted'
        : `${existingEvents.skippedLineCount} earlier events`;
    process.stderr.write(chalk.dim(`  ... (${omitted})\n\n`));
  }
  for (const line of existingEvents.lines) {
    try {
      displayEvent(JSON.parse(line));
    } catch {
      /* skip malformed */
    }
  }

  if (opts.snapshot) {
    displayCompletionSummary(completedPath);
    return;
  }

  const poll = setInterval(() => {
    if (!fs.existsSync(eventsPath)) return;
    const stat = fs.statSync(eventsPath);
    if (stat.size <= bytesRead) return;

    const fd = fs.openSync(eventsPath, 'r');
    const buf = Buffer.alloc(stat.size - bytesRead);
    fs.readSync(fd, buf, 0, buf.length, bytesRead);
    fs.closeSync(fd);
    bytesRead = stat.size;

    for (const line of buf.toString('utf-8').split('\n').filter(Boolean)) {
      try {
        displayEvent(JSON.parse(line));
      } catch {
        /* skip malformed */
      }
    }
  }, 200);

  const completionPoll = setInterval(() => {
    if (fs.existsSync(completedPath)) {
      clearInterval(poll);
      clearInterval(completionPoll);
      displayCompletionSummary(completedPath);
      process.exit(0);
    }
  }, 500);

  process.on('SIGINT', () => {
    clearInterval(poll);
    clearInterval(completionPoll);
    process.stderr.write(chalk.dim('\n  Stopped tailing.\n'));
    process.exit(0);
  });
}

function parseLineCount(value: string): number {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > 1000) {
    throw new InvalidArgumentError('lines must be an integer from 1 to 1000');
  }
  return count;
}

type RecentEventLines = {
  lines: string[];
  bytesRead: number;
  hasEarlier: boolean;
  skippedLineCount?: number;
  bytesScanned: number;
};

export function readRecentEventLines(
  eventsPath: string,
  lineCount: number,
): RecentEventLines {
  if (!fs.existsSync(eventsPath)) {
    return {
      lines: [],
      bytesRead: 0,
      hasEarlier: false,
      bytesScanned: 0,
    };
  }

  const stat = fs.statSync(eventsPath);
  if (stat.size === 0) {
    return {
      lines: [],
      bytesRead: 0,
      hasEarlier: false,
      bytesScanned: 0,
    };
  }

  const fd = fs.openSync(eventsPath, 'r');
  try {
    const chunks: Buffer[] = [];
    let offset = stat.size;
    let newlineCount = 0;
    let bytesScanned = 0;

    while (offset > 0 && newlineCount <= lineCount) {
      const readSize = Math.min(TAIL_READ_CHUNK_SIZE, offset);
      offset -= readSize;

      const chunk = Buffer.alloc(readSize);
      const actual = fs.readSync(fd, chunk, 0, readSize, offset);
      if (actual === 0) break;

      const readChunk = actual === readSize ? chunk : chunk.subarray(0, actual);
      chunks.unshift(readChunk);
      bytesScanned += actual;
      newlineCount += countNewlines(readChunk);
    }

    const text = Buffer.concat(chunks).toString('utf-8');
    const segments = text.split('\n');
    const completeSegments =
      offset > 0 && text.length > 0 && !text.startsWith('\n')
        ? segments.slice(1)
        : segments;
    const lines = completeSegments.filter(Boolean);
    const recent = lines.slice(-lineCount);
    const skippedLineCount =
      offset === 0 ? Math.max(0, lines.length - recent.length) : undefined;

    return {
      lines: recent,
      bytesRead: stat.size,
      hasEarlier: offset > 0 || lines.length > recent.length,
      skippedLineCount,
      bytesScanned,
    };
  } finally {
    fs.closeSync(fd);
  }
}

function countNewlines(buffer: Buffer): number {
  let count = 0;
  for (const byte of buffer) {
    if (byte === 10) count++;
  }
  return count;
}

function displayCompletionSummary(completedPath: string): void {
  if (!fs.existsSync(completedPath)) {
    process.stderr.write(
      chalk.dim('\n  Snapshot complete; run is still active.\n'),
    );
    return;
  }

  try {
    const completed = JSON.parse(fs.readFileSync(completedPath, 'utf-8'));
    const resultColor =
      completed.result === 'completed'
        ? chalk.green
        : completed.result === 'degraded'
          ? chalk.yellow
          : chalk.red;
    process.stderr.write(`\n${chalk.bold('─── Run Complete ───')}\n`);
    process.stderr.write(`  Result:     ${resultColor(completed.result)}\n`);
    process.stderr.write(
      `  Duration:   ${(completed.durationMs / 1000).toFixed(1)}s\n`,
    );
    process.stderr.write(
      `  Events:     ${completed.eventCount} (${completed.toolCallCount} tool calls)\n`,
    );
    const vIcon =
      completed.validated === true
        ? chalk.green('✓')
        : completed.validated === false
          ? chalk.red('✗')
          : '—';
    process.stderr.write(`  Validated:  ${vIcon}\n`);
  } catch {
    /* ignore */
  }
}
