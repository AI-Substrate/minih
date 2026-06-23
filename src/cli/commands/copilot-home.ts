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

import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { context, propagation } from '@opentelemetry/api';

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

/** Default large-logs warning threshold in MB — override `MINIH_COPILOT_HOME_WARN_MB`. */
const DEFAULT_WARN_MB = 500;

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

/**
 * The subset of `CopilotClientOptions` minih sets, plus the trace-context hook.
 * Typed locally so this module never imports `@github/copilot-sdk`.
 */
export interface CopilotClientOptions {
  onGetTraceContext: () => Record<string, string>;
  baseDirectory: string;
  gitHubToken: string | undefined;
  logLevel: CopilotLogLevel;
  telemetry?: { otlpEndpoint: string };
}

/**
 * Build the options passed to `new CopilotClient(...)`.
 *
 * Sets `baseDirectory` (→ `COPILOT_HOME` on the spawned runtime, relocating the
 * session store), `gitHubToken` (→ token auth, independent of
 * `~/.copilot/m-auth`; the SDK flips `useLoggedInUser` to false when a token is
 * present), and the toggleable `logLevel` — while PRESERVING the existing
 * `onGetTraceContext` trace-stitch hook (DD13) and the conditional `telemetry`
 * block. Pure (no SDK import, no I/O) so the wiring is the deterministic sensor
 * for AC-01 / AC-03 / AC-05.
 */
export function buildCopilotClientOptions(
  home: string,
  token: string | undefined,
  logLevel: CopilotLogLevel,
  otlpEndpoint?: string,
): CopilotClientOptions {
  return {
    onGetTraceContext: () => {
      const carrier: Record<string, string> = {};
      propagation.inject(context.active(), carrier);
      return carrier;
    },
    baseDirectory: home,
    gitHubToken: token,
    logLevel,
    ...(otlpEndpoint ? { telemetry: { otlpEndpoint } } : {}),
  };
}

/**
 * Warn (once, to stderr) when a repo's Copilot logs have grown large.
 *
 * Shallow-sums the file sizes directly under `<home>/logs` (one level only —
 * cheap even at multi-GB) and, if the total exceeds `MINIH_COPILOT_HOME_WARN_MB`
 * (default 500), prints a single line naming the area + the remedy. Silent when
 * the threshold isn't crossed or there is no `logs` directory. AC-06.
 */
export function warnIfHomeLogsLarge(home: string): void {
  const overrideMb = Number(process.env.MINIH_COPILOT_HOME_WARN_MB);
  const thresholdMb =
    Number.isFinite(overrideMb) && overrideMb > 0
      ? overrideMb
      : DEFAULT_WARN_MB;
  const logsDir = join(home, 'logs');

  let entries: string[];
  try {
    entries = readdirSync(logsDir);
  } catch {
    return; // no logs dir (or unreadable) → silent
  }

  let totalBytes = 0;
  for (const name of entries) {
    try {
      const st = statSync(join(logsDir, name));
      if (st.isFile()) totalBytes += st.size;
    } catch {
      // entry vanished or can't be stat'd mid-scan — skip it
    }
  }

  const totalMb = totalBytes / (1024 * 1024);
  if (totalMb > thresholdMb) {
    process.stderr.write(
      `⚠️  minih: Copilot logs in ${logsDir} are large ` +
        `(${totalMb.toFixed(0)} MB > ${thresholdMb} MB threshold). ` +
        `Lower verbosity with MINIH_COPILOT_LOG_LEVEL=error, raise the limit ` +
        `with MINIH_COPILOT_HOME_WARN_MB, or clear that directory.\n`,
    );
  }
}
