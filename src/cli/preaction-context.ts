import type { Command } from 'commander';
import { detectContext } from '../runner/index.js';
import {
  ErrorCodes,
  exitWithEnvelope,
  formatError,
  type MinihEnvelope,
} from './output.js';

export interface InsideContextBlockOptions {
  commandName: string;
  alternatives?: string[];
}

export function isInsideMinihSession(): boolean {
  return detectContext() === 'inside';
}

export function invalidContextEnvelope({
  commandName,
  alternatives = [],
}: InsideContextBlockOptions): MinihEnvelope {
  return formatError(
    commandName,
    ErrorCodes.INVALID_CONTEXT,
    `Cannot run \`minih ${commandName}\` from inside a minih session.`,
    {
      context: 'inside',
      expectedContext: 'outside',
      alternatives,
    },
  );
}

export function assertOutsideContext(options: InsideContextBlockOptions): void {
  if (!isInsideMinihSession()) return;
  exitWithEnvelope(invalidContextEnvelope(options));
}

export function blockInsideContext(
  command: Command,
  options: InsideContextBlockOptions,
): Command {
  return command.hook('preAction', () => {
    assertOutsideContext(options);
  });
}
