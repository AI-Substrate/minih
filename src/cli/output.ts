/**
 * CLI output envelope — the canonical JSON contract for all minih commands.
 *
 * Every command returns a MinihEnvelope to stdout.
 * Exit 0 for ok/degraded, exit 1 for error.
 * No zod — handwritten types (Finding 05).
 */

export const ErrorCodes = {
  UNKNOWN: 'E100',
  INVALID_ARGS: 'E108',
  AGENT_EXECUTION_FAILED: 'E120',
  AGENT_NOT_FOUND: 'E121',
  AGENT_AUTH_MISSING: 'E122',
  AGENT_TIMEOUT: 'E123',
  AGENT_VALIDATION_FAILED: 'E124',
  AGENT_INPUT_INVALID: 'E125',
  AGENT_SDK_MISSING: 'E126',
  AGENT_MODEL_INVALID: 'E127',
  INVALID_CONTEXT: 'E128',
  INIT_ALREADY_EXISTS: 'E130',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export interface MinihEnvelope {
  command: string;
  status: 'ok' | 'error' | 'degraded';
  timestamp: string;
  data?: unknown;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function formatSuccess<T>(
  command: string,
  data: T,
  status: 'ok' | 'degraded' = 'ok',
): MinihEnvelope {
  return {
    command,
    status,
    timestamp: new Date().toISOString(),
    data,
  };
}

export function formatError(
  command: string,
  code: ErrorCode | string,
  message: string,
  details?: unknown,
): MinihEnvelope {
  return {
    command,
    status: 'error',
    timestamp: new Date().toISOString(),
    error: {
      code,
      message,
      ...(details !== undefined && { details }),
    },
  };
}

export function printEnvelope(envelope: MinihEnvelope): void {
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
}

export function exitWithEnvelope(envelope: MinihEnvelope): never {
  printEnvelope(envelope);
  process.exit(envelope.status === 'error' ? 1 : 0);
}
