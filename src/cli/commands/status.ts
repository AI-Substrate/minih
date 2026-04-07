/**
 * minih status <slug> — one-shot liveness check for a running or completed agent.
 *
 * Reports: active / stale / completed / failed / unknown
 * Shows last N turns (tool_call + message events) for quick context.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import chalk from 'chalk';
import type { Command } from 'commander';
import { resolveAgent, validateSlug } from '../../runner/index.js';
import {
  ErrorCodes,
  exitWithEnvelope,
  formatError,
  formatSuccess,
} from '../output.js';

const STALE_THRESHOLD_MS = 60_000;
const DEFAULT_TURNS = 5;

interface TurnEntry {
  type: string;
  timestamp: string;
  summary: string;
}

function extractTurns(eventsPath: string, limit: number): TurnEntry[] {
  if (!fs.existsSync(eventsPath)) return [];
  const content = fs.readFileSync(eventsPath, 'utf-8');
  const lines = content.split('\n').filter(Boolean);

  const turns: TurnEntry[] = [];
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      const type: string = event.type;
      if (type === 'tool_call') {
        const name = event.data?.toolName ?? 'unknown';
        const input =
          typeof event.data?.input === 'string'
            ? event.data.input.slice(0, 80)
            : JSON.stringify(event.data?.input ?? '').slice(0, 80);
        turns.push({
          type,
          timestamp: event.timestamp,
          summary: `${name}: ${input}`,
        });
      } else if (type === 'message') {
        const msg = (event.data?.content ?? '').slice(0, 100);
        turns.push({ type, timestamp: event.timestamp, summary: msg });
      } else if (type === 'tool_result') {
        const output = (event.data?.output ?? '').slice(0, 80);
        const isError = event.data?.isError;
        turns.push({
          type: isError ? 'tool_error' : type,
          timestamp: event.timestamp,
          summary: output,
        });
      }
    } catch {
      /* skip malformed */
    }
  }

  return turns.slice(-limit);
}

function countEvents(eventsPath: string): { total: number; toolCalls: number } {
  if (!fs.existsSync(eventsPath)) return { total: 0, toolCalls: 0 };
  const content = fs.readFileSync(eventsPath, 'utf-8');
  const lines = content.split('\n').filter(Boolean);
  let toolCalls = 0;
  for (const line of lines) {
    try {
      if (JSON.parse(line).type === 'tool_call') toolCalls++;
    } catch {
      /* skip */
    }
  }
  return { total: lines.length, toolCalls };
}

export function registerStatusCommand(program: Command): void {
  program
    .command('status <slug>')
    .description('Check if an agent run is active, stale, or completed')
    .option('--run <runId>', 'Specific run ID (default: latest)')
    .option(
      '-n, --turns <count>',
      'Number of recent turns to show',
      String(DEFAULT_TURNS),
    )
    .action((slug: string, opts: { run?: string; turns?: string }) => {
      const agentsDir = program.opts().agentsDir ?? 'agents';
      const turnLimit =
        Number.parseInt(opts.turns ?? String(DEFAULT_TURNS), 10) ||
        DEFAULT_TURNS;

      const slugError = validateSlug(slug);
      if (slugError) {
        exitWithEnvelope(
          formatError('status', ErrorCodes.INVALID_ARGS, slugError),
        );
      }

      const definition = resolveAgent(slug, agentsDir);
      if (!definition) {
        exitWithEnvelope(
          formatError(
            'status',
            ErrorCodes.AGENT_NOT_FOUND,
            `Agent "${slug}" not found.`,
          ),
        );
        return;
      }

      const runsDir = path.join(definition.dir, 'runs');
      if (!fs.existsSync(runsDir)) {
        exitWithEnvelope(
          formatError(
            'status',
            ErrorCodes.AGENT_VALIDATION_FAILED,
            'No runs found.',
          ),
        );
        return;
      }

      const entries = fs
        .readdirSync(runsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .sort((a, b) => b.name.localeCompare(a.name));

      if (entries.length === 0) {
        exitWithEnvelope(
          formatError(
            'status',
            ErrorCodes.AGENT_VALIDATION_FAILED,
            'No runs found.',
          ),
        );
        return;
      }

      const runId = opts.run ?? entries[0].name;
      const runDir = path.join(runsDir, runId);
      const eventsPath = path.join(runDir, 'events.ndjson');
      const completedPath = path.join(runDir, 'completed.json');

      // Determine liveness
      let verdict: 'active' | 'stale' | 'completed' | 'failed' | 'unknown';
      let result: string | undefined;
      let durationMs: number | undefined;
      let sessionId: string | undefined;

      if (fs.existsSync(completedPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(completedPath, 'utf-8'));
          result = meta.result;
          durationMs = meta.durationMs;
          sessionId = meta.sessionId;
          verdict =
            meta.result === 'completed' || meta.result === 'degraded'
              ? 'completed'
              : 'failed';
        } catch {
          verdict = 'unknown';
        }
      } else if (fs.existsSync(eventsPath)) {
        const stat = fs.statSync(eventsPath);
        const ageMs = Date.now() - stat.mtimeMs;
        verdict = ageMs < STALE_THRESHOLD_MS ? 'active' : 'stale';
      } else {
        verdict = 'unknown';
      }

      // Elapsed time for in-progress runs
      let elapsedMs: number | undefined;
      if (!durationMs && fs.existsSync(runDir)) {
        const dirStat = fs.statSync(runDir);
        elapsedMs = Date.now() - dirStat.birthtimeMs;
      }

      const { total: eventCount, toolCalls: toolCallCount } =
        countEvents(eventsPath);
      const turns = extractTurns(eventsPath, turnLimit);

      // TTY display
      if (process.stderr.isTTY) {
        const verdictColor =
          verdict === 'active'
            ? chalk.green
            : verdict === 'stale'
              ? chalk.yellow
              : verdict === 'completed'
                ? chalk.green
                : verdict === 'failed'
                  ? chalk.red
                  : chalk.dim;

        const icon =
          verdict === 'active'
            ? '●'
            : verdict === 'stale'
              ? '◌'
              : verdict === 'completed'
                ? '✓'
                : verdict === 'failed'
                  ? '✗'
                  : '?';

        process.stderr.write(
          `\n  ${chalk.bold(`Status: ${slug}`)}  ${verdictColor(`${icon} ${verdict}`)}\n\n`,
        );
        process.stderr.write(`  Run:      ${chalk.dim(runId)}\n`);
        if (result) process.stderr.write(`  Result:   ${result}\n`);
        if (sessionId)
          process.stderr.write(`  Session:  ${chalk.dim(sessionId)}\n`);

        const elapsed = durationMs ?? elapsedMs;
        if (elapsed) {
          process.stderr.write(`  Elapsed:  ${(elapsed / 1000).toFixed(1)}s\n`);
        }
        process.stderr.write(
          `  Events:   ${eventCount} (${toolCallCount} tool calls)\n`,
        );

        if (turns.length > 0) {
          process.stderr.write(
            `\n  ${chalk.bold(`Last ${turns.length} turns:`)}\n`,
          );
          for (const turn of turns) {
            const icon =
              turn.type === 'tool_call'
                ? chalk.blue('🔧')
                : turn.type === 'tool_result'
                  ? chalk.dim('  ↳')
                  : turn.type === 'tool_error'
                    ? chalk.red('  ✗')
                    : chalk.cyan('💬');
            const ts = turn.timestamp
              ? chalk.dim(turn.timestamp.slice(11, 19))
              : '';
            process.stderr.write(`  ${ts} ${icon} ${turn.summary}\n`);
          }
        }
        process.stderr.write('\n');
      }

      exitWithEnvelope(
        formatSuccess('status', {
          slug,
          runId,
          verdict,
          result: result ?? null,
          sessionId: sessionId ?? null,
          durationMs: durationMs ?? null,
          elapsedMs: elapsedMs ?? null,
          eventCount,
          toolCallCount,
          turns,
        }),
      );
    });
}
