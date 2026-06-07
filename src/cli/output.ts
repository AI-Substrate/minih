/**
 * CLI output envelope — the canonical JSON contract for all minih commands.
 *
 * Every command returns a MinihEnvelope to stdout.
 * Exit 0 for ok/degraded, exit 1 for error.
 * No zod — handwritten types (Finding 05).
 *
 * Error code table (grep `Exxx` to find call sites):
 *   E100  UNKNOWN                  — unclassified failure
 *   E108  INVALID_ARGS             — argument/flag validation
 *   E120  AGENT_EXECUTION_FAILED   — agent run errored
 *   E121  AGENT_NOT_FOUND          — agent slug doesn't resolve
 *   E122  AGENT_AUTH_MISSING       — Copilot auth not present
 *   E123  AGENT_TIMEOUT            — adapter exceeded timeout
 *   E124  AGENT_VALIDATION_FAILED  — output schema mismatch
 *   E125  AGENT_INPUT_INVALID      — input params failed validation
 *   E126  AGENT_SDK_MISSING        — @github/copilot-sdk not installed
 *   E127  AGENT_MODEL_INVALID      — model name not registered with SDK
 *   E128  INVALID_CONTEXT          — outside/inside lane mismatch
 *   E130  INIT_ALREADY_EXISTS      — `minih init` target dir not empty
 *
 * Plan 010 — coordination CLI ergonomics:
 *   E140  NOT_COORDINATED          — agent has no `outside.md`
 *   E141  WAIT_OUT_OF_RANGE        — `--wait` outside [0, 300_000]
 *   E142  AGENT_GONE               — agent process died during long-poll
 *   E143  INSIDE_READ_ONLY         — write attempted on inside lane
 *   E144  ALREADY_ACTIVE           — resume target is active without --takeover
 *   E145  NO_RUN_TO_RESUME         — no eligible run for slug
 *   E146  SESSION_EXPIRED          — SDK session no longer resumable
 *   E147  RESUME_IN_PROGRESS       — resume-intent.lock held by another caller
 *   E148  INBOX_CORRUPT            — inbox file has torn final line
 *   E149  MCP_SPAWN_FAILED         — inside MCP subprocess failed to start
 *
 * Plan 017 — agent-pack install/info/list/remove:
 *   E180  AGENT_PACK_REGISTRY_MISS     — slug not in baked-in registry (and not a git URL)
 *   E181  AGENT_PACK_FETCH_FAILED      — network/git error pulling source
 *   E182  AGENT_PACK_INVALID           — downloaded archive missing prompt.md or has wrong shape
 *   E183  AGENT_PACK_ALREADY_INSTALLED — folder exists locally without `.minih-source.json` (hand-rolled agent)
 *   E184  AGENT_PACK_SOURCE_MISMATCH   — `.minih-source.json` source URL mismatch
 *
 *   --- Plan 018 (agent permissions) ---
 *   E200  PERMISSION_DENIED                — agent denied at runtime; terminal failure
 *   E201  ALLOWED_ROOTS_INVALID            — allowedRoots composition empty / unresolvable
 *   E202  FORBIDDEN_ROOT                   — allowedRoots includes /, /etc, etc.
 *   E203  PERMISSIONS_FRONTMATTER_INVALID  — `permissions:` field has a bad shape
 *   E204  PERMISSION_PRESET_UNKNOWN        — preset name not in the registry
 *   E205  COORDINATION_WRITE_DENIED        — coord-enabled agent resolved to write:deny preset (FX008)
 *
 *   --- Plan 022 (skills config) ---
 *   E210  SKILLS_CONFIG_INVALID            — .minih.json skills block has invalid shape
 *   E211  SKILL_NOT_FOUND                  — explicitly included skill was not found
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
  // Plan 010 — coordination CLI ergonomics
  NOT_COORDINATED: 'E140',
  WAIT_OUT_OF_RANGE: 'E141',
  AGENT_GONE: 'E142',
  INSIDE_READ_ONLY: 'E143',
  ALREADY_ACTIVE: 'E144',
  NO_RUN_TO_RESUME: 'E145',
  SESSION_EXPIRED: 'E146',
  RESUME_IN_PROGRESS: 'E147',
  INBOX_CORRUPT: 'E148',
  MCP_SPAWN_FAILED: 'E149',
  // Plan 012 — peer activity telemetry
  DEAF_PEER: 'E150',
  // Plan 015 — agent-readme command
  README_NOT_FOUND: 'E160',
  // Plan 009 Phase 2 — view command
  AMBIGUOUS_RUN_ID: 'E170',
  RUN_NOT_FOUND: 'E171',
  // Plan 017 — agent-pack install/info/list/remove
  AGENT_PACK_REGISTRY_MISS: 'E180',
  AGENT_PACK_FETCH_FAILED: 'E181',
  AGENT_PACK_INVALID: 'E182',
  AGENT_PACK_ALREADY_INSTALLED: 'E183',
  AGENT_PACK_SOURCE_MISMATCH: 'E184',
  // Plan 018 — agent permissions
  PERMISSION_DENIED: 'E200',
  ALLOWED_ROOTS_INVALID: 'E201',
  FORBIDDEN_ROOT: 'E202',
  PERMISSIONS_FRONTMATTER_INVALID: 'E203',
  PERMISSION_PRESET_UNKNOWN: 'E204',
  // Plan 018 — FX008 — coordination write precondition
  COORDINATION_WRITE_DENIED: 'E205',
  // Plan 022 — skills config
  SKILLS_CONFIG_INVALID: 'E210',
  SKILL_NOT_FOUND: 'E211',
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
