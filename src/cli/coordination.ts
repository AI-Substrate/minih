import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { AgentDefinition, InboxMessage, Side } from '../runner/index.js';
import {
  inboxLanePath,
  listAgents,
  OutsideAgentsDirError,
  resolveAgent,
  validateSlug,
} from '../runner/index.js';
import {
  ErrorCodes,
  exitWithEnvelope,
  formatError,
  type MinihEnvelope,
} from './output.js';

export const INBOX_MESSAGE_SCHEMA_PATH = fileURLToPath(
  new URL('../schemas/inbox-message.json', import.meta.url),
);

export function resolveAgentOrExit(
  commandName: string,
  slug: string,
  agentsDir: string,
): AgentDefinition {
  const slugError = validateSlug(slug);
  if (slugError) {
    exitWithEnvelope(
      formatError(commandName, ErrorCodes.INVALID_ARGS, slugError),
    );
  }

  let definition: AgentDefinition | null;
  try {
    definition = resolveAgent(slug, agentsDir);
  } catch (error) {
    if (error instanceof OutsideAgentsDirError) {
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
  if (!definition) {
    let available: string[] = [];
    try {
      available = listAgents(agentsDir).map((agent) => agent.slug);
    } catch (error) {
      if (error instanceof OutsideAgentsDirError) {
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
    exitWithEnvelope(
      formatError(
        commandName,
        ErrorCodes.AGENT_NOT_FOUND,
        `Agent "${slug}" not found.${available.length ? ` Available: ${available.join(', ')}` : ' No agents defined yet.'}`,
      ),
    );
  }
  return definition;
}

export function appendInboxMessage(
  commandName: string,
  slug: string,
  agentsDir: string,
  lane: Side,
  message: InboxMessage,
): void {
  const validation = validateJsonSchema(
    INBOX_MESSAGE_SCHEMA_PATH,
    message,
    'InboxMessage',
  );
  if (validation.length > 0) {
    exitWithEnvelope(
      formatError(
        commandName,
        ErrorCodes.INVALID_ARGS,
        'Inbox message failed schema validation.',
        { errors: validation },
      ),
    );
  }

  const filePath = inboxLanePath(slug, agentsDir, lane);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(message)}\n`);
}

export function readInboxLaneOrExit(
  commandName: string,
  slug: string,
  agentsDir: string,
  lane: Side,
): InboxMessage[] {
  const filePath = inboxLanePath(slug, agentsDir, lane);
  if (!fs.existsSync(filePath)) return [];

  const raw = fs.readFileSync(filePath, 'utf8');
  if (raw === '') return [];
  if (!raw.endsWith('\n')) {
    exitWithEnvelope(
      formatError(
        commandName,
        ErrorCodes.AGENT_VALIDATION_FAILED,
        'Inbox lane is corrupt: torn final line.',
        { filePath },
      ),
    );
  }

  const messages: InboxMessage[] = [];
  const lines = raw.split('\n');
  for (let index = 0; index < lines.length - 1; index++) {
    const line = lines[index];
    if (line.trim() === '') {
      exitWithEnvelope(
        formatError(
          commandName,
          ErrorCodes.AGENT_VALIDATION_FAILED,
          'Inbox lane is corrupt: empty line.',
          { filePath, line: index + 1 },
        ),
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      exitWithEnvelope(
        formatError(
          commandName,
          ErrorCodes.AGENT_VALIDATION_FAILED,
          'Inbox lane is corrupt: malformed JSON.',
          {
            filePath,
            line: index + 1,
            error: error instanceof Error ? error.message : String(error),
          },
        ),
      );
    }

    const validation = validateJsonSchema(
      INBOX_MESSAGE_SCHEMA_PATH,
      parsed,
      'InboxMessage',
    );
    if (validation.length > 0) {
      exitWithEnvelope(
        formatError(
          commandName,
          ErrorCodes.AGENT_VALIDATION_FAILED,
          'Inbox lane is corrupt: message failed schema validation.',
          { filePath, line: index + 1, errors: validation },
        ),
      );
    }

    const message = parsed as InboxMessage;
    if (message.sender !== lane) {
      exitWithEnvelope(
        formatError(
          commandName,
          ErrorCodes.AGENT_VALIDATION_FAILED,
          'Inbox lane is corrupt: message is in the wrong lane.',
          { filePath, line: index + 1, sender: message.sender, lane },
        ),
      );
    }
    messages.push(message);
  }
  return messages;
}

export function validateJsonSchema(
  schemaPath: string,
  data: unknown,
  label: string,
): string[] {
  let schema: unknown;
  try {
    schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  } catch (error) {
    return [
      `${label} schema is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }

  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);

  let validate: ReturnType<typeof ajv.compile>;
  try {
    validate = ajv.compile(schema as Record<string, unknown>);
  } catch (error) {
    return [
      `${label} schema failed to compile: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }

  if (validate(data)) return [];
  return (validate.errors ?? []).map((error) => {
    const instancePath = error.instancePath || '/';
    return `${instancePath}: ${error.message ?? 'unknown validation error'}`;
  });
}

export function invalidArgs(
  commandName: string,
  message: string,
  details?: unknown,
): MinihEnvelope {
  return formatError(commandName, ErrorCodes.INVALID_ARGS, message, details);
}

export function requireNonEmptyOption(
  commandName: string,
  value: string | undefined,
  flag: string,
): string {
  if (typeof value !== 'string' || value.trim() === '') {
    exitWithEnvelope(
      invalidArgs(commandName, `Missing required option: ${flag}`),
    );
  }
  return value;
}

export function requireStringOption(
  commandName: string,
  value: string | undefined,
  flag: string,
): string {
  if (typeof value !== 'string') {
    exitWithEnvelope(
      invalidArgs(commandName, `Missing required option: ${flag}`),
    );
  }
  return value;
}
