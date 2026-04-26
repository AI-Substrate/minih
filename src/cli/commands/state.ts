import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import type { Command } from 'commander';
import {
  type AgentDefinition,
  appendHistory,
  HistoryLineTooLargeError,
  type OutsideState,
  readStateLazy,
  type Side,
  type SideState,
  StateCorruptError,
  writeState,
} from '../../runner/index.js';
import {
  invalidArgs,
  requireNonEmptyOption,
  resolveAgentOrExit,
  validateJsonSchema,
} from '../coordination.js';
import {
  ErrorCodes,
  exitWithEnvelope,
  formatError,
  formatSuccess,
} from '../output.js';

const DEFAULT_OUTSIDE_STATE_SCHEMA = fileURLToPath(
  new URL('../../schemas/outside-state.json', import.meta.url),
);

type StateSideSelection = Side | 'both';

interface StateSetOptions {
  side?: string;
  status?: string;
  dataJson?: string;
  key?: string;
  value?: string;
  valueJson?: string;
}

export function registerStateCommand(program: Command): void {
  const state = program
    .command('state')
    .description('Inspect and update coordination state');

  state
    .command('get <slug>')
    .description('Read outside, inside, or both coordination states')
    .option('--side <side>', 'outside, inside, or both', 'both')
    .option('--key <dotPath>', 'Optional dot-path to read')
    .action((slug: string, opts: { side?: string; key?: string }) => {
      const commandName = 'state.get';
      const agentsDir = program.opts().agentsDir ?? 'agents';
      resolveAgentOrExit(commandName, slug, agentsDir);
      const side = parseStateSide(commandName, opts.side);
      const key = parseOptionalKey(commandName, opts.key);

      withStateErrors(commandName, () => {
        const payload = readStatePayload(side, slug, agentsDir, key);
        exitWithEnvelope(formatSuccess(commandName, { slug, ...payload }));
      });
    });

  state
    .command('set <slug>')
    .description('Update outside-owned coordination state')
    .option('--side <side>', 'Must be outside for writes')
    .option('--status <status>', 'New outside status')
    .option('--data-json <json>', 'Replacement outside data object')
    .option('--key <dotPath>', 'State key to set: status, data, or data.<path>')
    .option('--value <value>', 'String value for --key')
    .option('--value-json <json>', 'JSON value for --key')
    .action((slug: string, opts: StateSetOptions) => {
      const commandName = 'state.set';
      const agentsDir = program.opts().agentsDir ?? 'agents';
      const definition = resolveAgentOrExit(commandName, slug, agentsDir);
      if (opts.side !== 'outside') {
        exitWithEnvelope(
          invalidArgs(commandName, 'state set only supports --side outside'),
        );
      }

      withStateErrors(commandName, () => {
        const current = readStateLazy(
          'outside',
          slug,
          agentsDir,
        ) as OutsideState;
        const next = buildSetState(commandName, current, opts);
        validateOutsideStateOrExit(commandName, definition, next);
        writeOutsideState(slug, agentsDir, current, next, null);

        if (process.stderr.isTTY) {
          process.stderr.write(
            `\n  ${chalk.green('✓')} outside state for ${chalk.cyan(slug)} is ${chalk.cyan(next.status)}\n\n`,
          );
        }

        exitWithEnvelope(formatSuccess(commandName, { slug, state: next }));
      });
    });

  state
    .command('transition <slug>')
    .description('Transition outside-owned status and append history')
    .option('--to <status>', 'Target outside status')
    .option('--reason <text>', 'Optional transition reason')
    .option('--data-json <json>', 'Replacement outside data object')
    .action(
      (
        slug: string,
        opts: { to?: string; reason?: string; dataJson?: string },
      ) => {
        const commandName = 'state.transition';
        const agentsDir = program.opts().agentsDir ?? 'agents';
        const definition = resolveAgentOrExit(commandName, slug, agentsDir);
        const to = requireNonEmptyOption(commandName, opts.to, '--to');

        withStateErrors(commandName, () => {
          const current = readStateLazy(
            'outside',
            slug,
            agentsDir,
          ) as OutsideState;
          const data =
            opts.dataJson === undefined
              ? current.data
              : parseJsonObject(commandName, opts.dataJson, '--data-json');
          const next = buildOutsideState(to, data);
          validateOutsideStateOrExit(commandName, definition, next);

          if (current.status === next.status && deepEqual(current.data, data)) {
            exitWithEnvelope(
              formatSuccess(commandName, {
                slug,
                state: current,
                transitioned: false,
                from: current.status,
                to,
              }),
            );
          }

          writeOutsideState(
            slug,
            agentsDir,
            current,
            next,
            opts.reason ?? null,
          );

          if (process.stderr.isTTY) {
            process.stderr.write(
              `\n  ${chalk.green('✓')} transitioned ${chalk.cyan(slug)} outside state ${chalk.dim(current.status)} → ${chalk.cyan(to)}\n\n`,
            );
          }

          exitWithEnvelope(
            formatSuccess(commandName, {
              slug,
              state: next,
              transitioned: true,
              from: current.status,
              to,
            }),
          );
        });
      },
    );
}

function readStatePayload(
  side: StateSideSelection,
  slug: string,
  agentsDir: string,
  key: string | undefined,
): Record<string, unknown> {
  if (side === 'both') {
    const outside = readStateLazy('outside', slug, agentsDir);
    const inside = readStateLazy('inside', slug, agentsDir);
    if (key !== undefined) {
      return {
        side,
        key,
        outside: readStateKey(outside, key),
        inside: readStateKey(inside, key),
      };
    }
    return { side, outside, inside };
  }

  const state = readStateLazy(side, slug, agentsDir);
  if (key !== undefined) {
    return { side, key, value: readStateKey(state, key) };
  }
  return { side, state };
}

function buildSetState(
  commandName: string,
  current: OutsideState,
  opts: StateSetOptions,
): OutsideState {
  const hasKey = opts.key !== undefined;
  const hasStatus = opts.status !== undefined;
  const hasDataJson = opts.dataJson !== undefined;

  if (hasKey) {
    if (hasStatus || hasDataJson) {
      exitWithEnvelope(
        invalidArgs(
          commandName,
          '--key cannot be combined with --status or --data-json',
        ),
      );
    }
    const hasValue = opts.value !== undefined;
    const hasValueJson = opts.valueJson !== undefined;
    if (hasValue === hasValueJson) {
      exitWithEnvelope(
        invalidArgs(
          commandName,
          '--key requires exactly one of --value or --value-json',
        ),
      );
    }
    const value = hasValue
      ? (opts.value as string)
      : parseJsonValue(commandName, opts.valueJson as string, '--value-json');
    return setStateKey(commandName, current, opts.key as string, value);
  }

  if (!hasStatus && !hasDataJson) {
    exitWithEnvelope(
      invalidArgs(
        commandName,
        'state set requires --status, --data-json, or --key',
      ),
    );
  }
  if (opts.value !== undefined || opts.valueJson !== undefined) {
    exitWithEnvelope(
      invalidArgs(commandName, '--value and --value-json require --key'),
    );
  }

  return buildOutsideState(
    hasStatus
      ? requireNonEmptyOption(commandName, opts.status, '--status')
      : current.status,
    hasDataJson
      ? parseJsonObject(commandName, opts.dataJson as string, '--data-json')
      : current.data,
  );
}

function buildOutsideState(
  status: string,
  data: Record<string, unknown>,
): OutsideState {
  return {
    status,
    data,
    updatedAt: new Date().toISOString(),
    updatedBy: 'outside',
  };
}

function writeOutsideState(
  slug: string,
  agentsDir: string,
  current: OutsideState,
  next: OutsideState,
  reason: string | null,
): void {
  appendHistory(slug, agentsDir, {
    ts: next.updatedAt,
    side: 'outside',
    from: current.status,
    to: next.status,
    reason,
  });
  writeState('outside', slug, agentsDir, next);
}

function validateOutsideStateOrExit(
  commandName: string,
  definition: AgentDefinition,
  state: OutsideState,
): void {
  const schemaPath = outsideStateSchemaPath(definition);
  const errors = validateJsonSchema(schemaPath, state, 'OutsideState');
  if (errors.length === 0) return;
  exitWithEnvelope(
    formatError(
      commandName,
      ErrorCodes.INVALID_ARGS,
      'State does not match outside state schema.',
      { schemaPath, errors },
    ),
  );
}

function outsideStateSchemaPath(definition: AgentDefinition): string {
  const localSchema = path.join(definition.dir, 'outside-state.schema.json');
  return fs.existsSync(localSchema)
    ? localSchema
    : DEFAULT_OUTSIDE_STATE_SCHEMA;
}

function setStateKey(
  commandName: string,
  current: OutsideState,
  key: string,
  value: unknown,
): OutsideState {
  const segments = parseKeySegments(commandName, key);
  const next = buildOutsideState(current.status, deepCloneRecord(current.data));

  if (segments[0] === 'status') {
    if (
      segments.length !== 1 ||
      typeof value !== 'string' ||
      value.trim() === ''
    ) {
      exitWithEnvelope(
        invalidArgs(
          commandName,
          '--key status requires a non-empty string value',
        ),
      );
    }
    return { ...next, status: value };
  }

  if (segments[0] !== 'data') {
    exitWithEnvelope(
      invalidArgs(
        commandName,
        '--key supports only status, data, or data.<path>',
      ),
    );
  }

  if (segments.length === 1) {
    if (!isRecord(value)) {
      exitWithEnvelope(
        invalidArgs(commandName, '--key data requires an object JSON value'),
      );
    }
    return { ...next, data: value };
  }

  setNestedData(next.data, segments.slice(1), value);
  return next;
}

function setNestedData(
  root: Record<string, unknown>,
  segments: string[],
  value: unknown,
): void {
  let current = root;
  for (const segment of segments.slice(0, -1)) {
    const existing = current[segment];
    if (!isRecord(existing)) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }
  current[segments[segments.length - 1] as string] = value;
}

function parseStateSide(
  commandName: string,
  value: string | undefined,
): StateSideSelection {
  if (value === undefined || value === 'both') return 'both';
  if (value === 'outside' || value === 'inside') return value;
  exitWithEnvelope(
    invalidArgs(commandName, '--side must be outside, inside, or both'),
  );
}

function parseOptionalKey(
  commandName: string,
  value: string | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  parseKeySegments(commandName, value);
  return value;
}

function parseKeySegments(commandName: string, key: string): string[] {
  if (key.trim() === '') {
    exitWithEnvelope(invalidArgs(commandName, '--key must be non-empty'));
  }
  const segments = key.split('.');
  if (segments.some((segment) => segment === '')) {
    exitWithEnvelope(
      invalidArgs(
        commandName,
        '--key must be a dot path without empty segments',
      ),
    );
  }
  return segments;
}

function parseJsonObject(
  commandName: string,
  raw: string,
  flag: string,
): Record<string, unknown> {
  const value = parseJsonValue(commandName, raw, flag);
  if (!isRecord(value)) {
    exitWithEnvelope(invalidArgs(commandName, `${flag} must be a JSON object`));
  }
  return value;
}

function parseJsonValue(
  commandName: string,
  raw: string,
  flag: string,
): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    exitWithEnvelope(
      invalidArgs(commandName, `${flag} is not valid JSON`, {
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

function withStateErrors(commandName: string, fn: () => void): void {
  try {
    fn();
  } catch (error) {
    if (error instanceof StateCorruptError) {
      exitWithEnvelope(
        formatError(
          commandName,
          ErrorCodes.AGENT_VALIDATION_FAILED,
          error.message,
        ),
      );
    }
    if (error instanceof HistoryLineTooLargeError) {
      exitWithEnvelope(
        formatError(
          commandName,
          ErrorCodes.AGENT_VALIDATION_FAILED,
          error.message,
        ),
      );
    }
    throw error;
  }
}

function readStateKey(state: SideState, key: string): unknown {
  let current: unknown = state;
  for (const segment of key.split('.')) {
    if (typeof current !== 'object' || current === null) return null;
    if (!Object.hasOwn(current, segment)) return null;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function deepCloneRecord(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function deepEqual(left: unknown, right: unknown): boolean {
  return stableStringify(left) === stableStringify(right);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
