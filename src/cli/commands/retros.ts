import * as fs from 'node:fs';
import * as path from 'node:path';
import chalk from 'chalk';
import Table from 'cli-table3';
import type { Command } from 'commander';
import type {
  AgentDefinition,
  InboxMessage,
  Side,
} from '../../runner/index.js';
import { listAgents, validateSlug } from '../../runner/index.js';
import {
  invalidArgs,
  readInboxLaneOrExit,
  resolveAgentOrExit,
} from '../coordination.js';
import { exitWithEnvelope, formatSuccess } from '../output.js';

const COMMAND = 'retros';
const TARGETS = ['project', 'minih', 'coordination'] as const;
type MagicWandTarget = (typeof TARGETS)[number];
type RetroSide = 'inside' | 'outside';

interface RetroEntry {
  agent: string;
  side: RetroSide;
  source: 'report' | 'outside-message';
  target: string | null;
  body: string;
  workedWell?: string | null;
  confusing?: string | null;
  magicWand?: string | null;
  runId?: string;
  messageId?: string;
  timestamp?: string;
  coordination?: Record<string, unknown> | null;
}

interface RetroFilters {
  agent?: string;
  side?: RetroSide;
  target?: MagicWandTarget;
}

export function registerRetrosCommand(program: Command): void {
  program
    .command(COMMAND)
    .description('Aggregate inside and outside retrospective feedback')
    .option('--agent <slug>', 'Filter to a specific agent')
    .option('--side <side>', 'inside or outside')
    .option('--target <target>', 'project, minih, or coordination')
    .action((opts: { agent?: string; side?: string; target?: string }) => {
      const agentsDir = program.opts().agentsDir ?? 'agents';
      const filters = parseFilters(opts);
      const agents = selectAgents(agentsDir, filters.agent);
      const entries = collectRetros(agentsDir, agents, filters);

      if (process.stderr.isTTY) {
        renderRetrosTable(entries);
      }

      exitWithEnvelope(
        formatSuccess(COMMAND, {
          entries,
          count: entries.length,
          filters: {
            agent: filters.agent ?? null,
            side: filters.side ?? null,
            target: filters.target ?? null,
          },
        }),
      );
    });
}

function parseFilters(opts: {
  agent?: string;
  side?: string;
  target?: string;
}): RetroFilters {
  if (opts.agent) {
    const slugError = validateSlug(opts.agent);
    if (slugError) exitWithEnvelope(invalidArgs(COMMAND, slugError));
  }

  let side: RetroSide | undefined;
  if (opts.side !== undefined) {
    if (opts.side !== 'inside' && opts.side !== 'outside') {
      exitWithEnvelope(
        invalidArgs(COMMAND, '--side must be inside or outside'),
      );
    }
    side = opts.side;
  }

  let target: MagicWandTarget | undefined;
  if (opts.target !== undefined) {
    if (!(TARGETS as readonly string[]).includes(opts.target)) {
      exitWithEnvelope(
        invalidArgs(
          COMMAND,
          '--target must be project, minih, or coordination',
        ),
      );
    }
    target = opts.target as MagicWandTarget;
  }

  return {
    ...(opts.agent && { agent: opts.agent }),
    ...(side && { side }),
    ...(target && { target }),
  };
}

function selectAgents(
  agentsDir: string,
  agentSlug: string | undefined,
): AgentDefinition[] {
  if (agentSlug !== undefined) {
    return [resolveAgentOrExit(COMMAND, agentSlug, agentsDir)];
  }
  return listAgents(agentsDir);
}

function collectRetros(
  agentsDir: string,
  agents: AgentDefinition[],
  filters: RetroFilters,
): RetroEntry[] {
  const entries: RetroEntry[] = [];
  for (const agent of agents) {
    if (filters.side !== 'outside') {
      entries.push(...collectInsideRetros(agent, filters));
    }
    if (filters.side !== 'inside') {
      entries.push(...collectOutsideRetros(agentsDir, agent, filters));
    }
  }
  return entries;
}

function collectInsideRetros(
  agent: AgentDefinition,
  filters: RetroFilters,
): RetroEntry[] {
  const runsDir = path.join(agent.dir, 'runs');
  if (!fs.existsSync(runsDir)) return [];

  const runDirs = fs
    .readdirSync(runsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => b.name.localeCompare(a.name));

  const entries: RetroEntry[] = [];
  for (const runDir of runDirs) {
    if (!isCompletedRun(path.join(runsDir, runDir.name))) continue;
    const report = readJsonFile(
      path.join(runsDir, runDir.name, 'output', 'report.json'),
    );
    if (!isRecord(report) || !isRecord(report.retrospective)) continue;

    const retrospective = report.retrospective;
    const target = stringOrNull(retrospective.magicWandTarget);
    if (!passesTarget(target, filters.target)) continue;

    const magicWand = stringOrNull(retrospective.magicWand);
    const workedWell = stringOrNull(retrospective.workedWell);
    const confusing = stringOrNull(retrospective.confusing);
    if (magicWand === null && workedWell === null && confusing === null) {
      continue;
    }

    entries.push({
      agent: agent.slug,
      side: 'inside',
      source: 'report',
      target,
      body: magicWand ?? workedWell ?? confusing ?? '',
      workedWell,
      confusing,
      magicWand,
      runId: runDir.name,
      coordination: isRecord(retrospective.coordination)
        ? retrospective.coordination
        : null,
    });
  }
  return entries;
}

function collectOutsideRetros(
  agentsDir: string,
  agent: AgentDefinition,
  filters: RetroFilters,
): RetroEntry[] {
  return readInboxLaneOrExit(COMMAND, agent.slug, agentsDir, 'outside')
    .filter((message) => message.type === 'retro')
    .map((message) => outsideMessageToRetro(agent.slug, message))
    .filter((entry) => passesTarget(entry.target, filters.target));
}

function outsideMessageToRetro(
  agentSlug: string,
  message: InboxMessage,
): RetroEntry {
  return {
    agent: agentSlug,
    side: 'outside',
    source: 'outside-message',
    target: isRecord(message.meta)
      ? stringOrNull(message.meta.magicWandTarget)
      : null,
    body: message.body,
    magicWand: message.body,
    messageId: message.id,
    timestamp: message.ts,
  };
}

function passesTarget(
  entryTarget: string | null,
  filterTarget: MagicWandTarget | undefined,
): boolean {
  if (filterTarget === undefined) return true;
  return entryTarget === filterTarget;
}

function isCompletedRun(runDir: string): boolean {
  const completed = readJsonFile(path.join(runDir, 'completed.json'));
  if (!isRecord(completed)) return false;
  return completed.result === 'completed' || completed.result === 'degraded';
}

function readJsonFile(filePath: string): unknown | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function renderRetrosTable(entries: RetroEntry[]): void {
  if (entries.length === 0) {
    process.stderr.write(
      `\n  ${chalk.dim('No retrospective feedback found.')}\n\n`,
    );
    return;
  }

  const table = new Table({
    head: [
      chalk.bold('Agent'),
      chalk.bold('Side'),
      chalk.bold('Target'),
      chalk.bold('Feedback'),
    ],
    style: { head: [], border: [] },
    colWidths: [18, 10, 14, 72],
    wordWrap: true,
  });

  for (const entry of entries) {
    table.push([
      chalk.cyan(entry.agent),
      entry.side,
      entry.target ?? chalk.dim('—'),
      entry.body.slice(0, 200),
    ]);
  }

  process.stderr.write(`\n${table.toString()}\n\n`);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type { RetroEntry, RetroFilters, Side };
