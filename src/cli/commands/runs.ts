import * as fs from 'node:fs';
import Table from 'cli-table3';
import type { Command } from 'commander';
import {
  getRunStatuses,
  listRunInventory,
  type RunInventoryRow,
  type RunStatusRow,
  summarizeStatusRows,
} from '../../runner/index.js';
import {
  ErrorCodes,
  exitWithEnvelope,
  formatError,
  formatSuccess,
} from '../output.js';

interface ListOpts {
  active?: boolean;
  all?: boolean;
  slug?: string;
  limit?: string;
}

interface StatusOpts {
  run?: string[];
  from?: string;
}

export function registerRunsCommand(program: Command): void {
  const runs = program
    .command('runs')
    .description('List and inspect runs across agents');

  runs
    .command('list')
    .description('List active or recent runs across all agents')
    .option('--active', 'Only show active/stale/dead live-run rows')
    .option('--all', 'Include historical rows, bounded by --limit')
    .option('--slug <slug>', 'Filter to one agent slug')
    .option('--limit <count>', 'Maximum rows to return (default: 50)', '50')
    .action(async (opts: ListOpts) => {
      const agentsDir = program.opts().agentsDir ?? 'agents';
      const limit = parseLimit(opts.limit);
      if (limit === null) {
        exitWithEnvelope(
          formatError(
            'runs.list',
            ErrorCodes.INVALID_ARGS,
            'limit must be a positive integer',
          ),
        );
      }
      const rows = await listRunInventory({
        agentsDir,
        slug: opts.slug,
        active: opts.active,
        all: opts.all,
        limit,
      });
      renderRunsTable(rows);
      exitWithEnvelope(
        formatSuccess('runs.list', {
          filters: {
            active: opts.active === true,
            all: opts.all === true,
            slug: opts.slug ?? null,
            limit,
          },
          runs: rows,
          count: rows.length,
        }),
      );
    });

  runs
    .command('status')
    .description('Inspect multiple explicit run targets')
    .option(
      '--run <slug/runId>',
      'Explicit run target; repeatable',
      (value: string, acc: string[]) => {
        acc.push(value);
        return acc;
      },
      [] as string[],
    )
    .option('--from <file>', 'Read slug/runId targets from a text file')
    .action(async (opts: StatusOpts) => {
      const agentsDir = program.opts().agentsDir ?? 'agents';
      const parsed = parseTargets(opts);
      if ('error' in parsed) {
        exitWithEnvelope(
          formatError('runs.status', ErrorCodes.INVALID_ARGS, parsed.error),
        );
      }
      const rows = [
        ...(await getRunStatuses({ agentsDir, targets: parsed.targets })),
        ...parsed.rowErrors,
      ];
      renderStatusTable(rows);
      const summary = summarizeStatusRows(rows);
      exitWithEnvelope(
        formatSuccess(
          'runs.status',
          { runs: rows, summary },
          summary.missing > 0 ? 'degraded' : 'ok',
        ),
      );
    });
}

function parseLimit(value: string | undefined): number | null {
  const limit = Number.parseInt(value ?? '50', 10);
  if (!Number.isInteger(limit) || limit < 1) return null;
  return limit;
}

function parseTargets(opts: StatusOpts):
  | {
      targets: Array<{ slug: string; runId: string; target: string }>;
      rowErrors: RunStatusRow[];
    }
  | { error: string } {
  const direct = opts.run ?? [];
  const fromFile = opts.from ? readTargetFile(opts.from) : [];
  if (fromFile instanceof Error) return { error: fromFile.message };
  if (direct.length + fromFile.length === 0) {
    return {
      error: 'Provide at least one --run <slug/runId> or --from <file> target.',
    };
  }
  const targets: Array<{ slug: string; runId: string; target: string }> = [];
  const rowErrors: RunStatusRow[] = [];

  for (const raw of direct) {
    const parsed = parseTarget(raw);
    if (!parsed) {
      return { error: `Invalid run target "${raw}". Expected <slug>/<runId>.` };
    }
    targets.push(parsed);
  }

  for (const raw of fromFile) {
    const parsed = parseTarget(raw);
    if (!parsed) {
      rowErrors.push(malformedTargetRow(raw));
      continue;
    }
    targets.push(parsed);
  }

  return { targets, rowErrors };
}

function parseTarget(
  raw: string,
): { slug: string; runId: string; target: string } | null {
  const parts = raw.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { slug: parts[0], runId: parts[1], target: raw };
}

function malformedTargetRow(raw: string): RunStatusRow {
  return {
    target: raw,
    found: false,
    slug: '',
    runId: '',
    liveness: 'unknown',
    manifestStatus: null,
    result: null,
    startedAt: null,
    updatedAt: null,
    completedAt: null,
    pid: null,
    model: null,
    sessionId: null,
    eventCount: 0,
    toolCallCount: 0,
    diagnostics: [],
    error: {
      code: ErrorCodes.INVALID_ARGS,
      message: `Invalid run target "${raw}". Expected <slug>/<runId>.`,
    },
  };
}

function readTargetFile(filePath: string): string[] | Error {
  try {
    return fs
      .readFileSync(filePath, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
  } catch (err) {
    return new Error(`Could not read target file: ${(err as Error).message}`);
  }
}

function renderRunsTable(rows: RunInventoryRow[]): void {
  if (!process.stderr.isTTY || rows.length === 0) return;
  const table = new Table({
    head: ['Slug', 'Run', 'Live', 'Label', 'Params'],
    style: { head: [], border: [] },
  });
  for (const row of rows) {
    table.push([
      row.slug,
      row.runId,
      row.liveness,
      row.label ?? '—',
      formatParamsSummary(row.paramsSummary),
    ]);
  }
  process.stderr.write(`\n${table.toString()}\n`);
}

function renderStatusTable(rows: RunStatusRow[]): void {
  if (!process.stderr.isTTY || rows.length === 0) return;
  const table = new Table({
    head: ['Target', 'Found', 'Live', 'Result', 'Label'],
    style: { head: [], border: [] },
  });
  for (const row of rows) {
    table.push([
      row.target,
      row.found ? 'yes' : 'no',
      row.liveness,
      row.result ?? '—',
      row.label ?? '—',
    ]);
  }
  process.stderr.write(`\n${table.toString()}\n`);
}

function formatParamsSummary(
  summary: RunInventoryRow['paramsSummary'],
): string {
  if (!summary) return '—';
  const pairs = Object.entries(summary.display).map(([k, v]) => `${k}=${v}`);
  const suffix = summary.truncated ? ' …' : '';
  return `${pairs.join(' ')}${suffix}` || '—';
}
