/**
 * Per-repo Copilot home isolation (plan 029).
 *
 * Pure, SDK-free helpers that decide WHERE the Copilot SDK runtime stores its
 * data (its `COPILOT_HOME`, set via the client `baseDirectory` option) and at
 * what verbosity, plus a cheap warning when a repo's Copilot logs grow large.
 *
 * Deliberately free of any `@github/copilot-sdk` import so they stay
 * unit-testable without spawning the SDK. The composition root
 * (`sdk-runtime.ts`) wires the results into `new CopilotClient(...)`.
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Mirror of the SDK's `CopilotClientOptions.logLevel` union
 * (`@github/copilot-sdk` `types.d.ts:181`). Kept local so this module never
 * imports the SDK.
 */
export type CopilotLogLevel =
  | 'none'
  | 'error'
  | 'warning'
  | 'info'
  | 'debug'
  | 'all';

const LOG_LEVELS: readonly CopilotLogLevel[] = [
  'none',
  'error',
  'warning',
  'info',
  'debug',
  'all',
];

/** Default runtime verbosity — toggleable via `MINIH_COPILOT_LOG_LEVEL`. */
const DEFAULT_LOG_LEVEL: CopilotLogLevel = 'info';

/**
 * Resolve the per-repo Copilot home and ensure the directory exists.
 *
 * `MINIH_COPILOT_HOME` overrides; otherwise `<cwd>/.minih/copilot-home`
 * (`process.cwd()` is the repo root, matching minih's `{{REPO_ROOT}}`).
 * The directory is created (recursive) so the SDK can write into it on the
 * very first run.
 */
export function resolveCopilotHome(): string {
  const home =
    process.env.MINIH_COPILOT_HOME ??
    join(process.cwd(), '.minih', 'copilot-home');
  mkdirSync(home, { recursive: true });
  return home;
}

/**
 * Resolve the SDK log level from `MINIH_COPILOT_LOG_LEVEL`.
 *
 * Falls back to `'info'` when the var is unset OR holds a value outside the
 * SDK union — an out-of-range string must never reach the SDK (AC-05).
 */
export function resolveCopilotLogLevel(): CopilotLogLevel {
  const raw = process.env.MINIH_COPILOT_LOG_LEVEL;
  if (raw !== undefined && (LOG_LEVELS as readonly string[]).includes(raw)) {
    return raw as CopilotLogLevel;
  }
  return DEFAULT_LOG_LEVEL;
}
