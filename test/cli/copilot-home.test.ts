/**
 * Plan 029 — per-repo Copilot home isolation. Unit tests for the pure,
 * SDK-free helpers in src/cli/commands/copilot-home.ts.
 *
 * No mocks of the SDK or fs — real temp dirs (mkdtemp) per the plan's testing
 * strategy. The buildCopilotClientOptions() cases are the deterministic sensor
 * for AC-01 / AC-03 / AC-05 and the T002 telemetry-preservation regression.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCopilotClientOptions,
  resolveCopilotHome,
  resolveCopilotLogLevel,
  warnIfHomeLogsLarge,
} from '../../src/cli/commands/copilot-home.js';

const ENV_KEYS = [
  'MINIH_COPILOT_HOME',
  'MINIH_COPILOT_LOG_LEVEL',
  'MINIH_COPILOT_HOME_WARN_MB',
] as const;

describe('copilot-home (plan 029)', () => {
  let saved: Record<string, string | undefined>;
  let originalCwd: string;
  let tmp: string;

  beforeEach(() => {
    saved = {};
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'minih-home-'));
  });

  afterEach(() => {
    process.chdir(originalCwd);
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    rmSync(tmp, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('resolveCopilotHome', () => {
    it('defaults to <cwd>/.minih/copilot-home and creates it', () => {
      process.chdir(tmp);
      const home = resolveCopilotHome();
      // Compare against process.cwd() (not tmp) to dodge macOS /private symlinks.
      expect(home).toBe(join(process.cwd(), '.minih', 'copilot-home'));
      expect(home.endsWith(join('.minih', 'copilot-home'))).toBe(true);
      expect(existsSync(home)).toBe(true);
    });

    it('honors MINIH_COPILOT_HOME override and creates it', () => {
      const override = join(tmp, 'custom-home');
      process.env.MINIH_COPILOT_HOME = override;
      const home = resolveCopilotHome();
      expect(home).toBe(override);
      expect(existsSync(home)).toBe(true);
    });
  });

  describe('resolveCopilotLogLevel', () => {
    it('returns a valid level when set', () => {
      process.env.MINIH_COPILOT_LOG_LEVEL = 'debug';
      expect(resolveCopilotLogLevel()).toBe('debug');
    });

    it('defaults to info when unset', () => {
      expect(resolveCopilotLogLevel()).toBe('info');
    });

    it('neg-control: an invalid value (verbose) falls back to info — never reaches the SDK', () => {
      process.env.MINIH_COPILOT_LOG_LEVEL = 'verbose';
      expect(resolveCopilotLogLevel()).toBe('info');
    });

    it('an empty string falls back to info', () => {
      process.env.MINIH_COPILOT_LOG_LEVEL = '';
      expect(resolveCopilotLogLevel()).toBe('info');
    });
  });

  describe('warnIfHomeLogsLarge', () => {
    function seedLogs(home: string, bytes: number): void {
      const logsDir = join(home, 'logs');
      mkdirSync(logsDir, { recursive: true });
      writeFileSync(join(logsDir, 'copilot.log'), Buffer.alloc(bytes));
    }

    it('warns once on stderr when logs exceed the threshold', () => {
      const home = join(tmp, 'over');
      mkdirSync(home, { recursive: true });
      seedLogs(home, 2 * 1024 * 1024); // 2 MB, just over a 1 MB threshold
      process.env.MINIH_COPILOT_HOME_WARN_MB = '1';
      const spy = vi
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true);

      warnIfHomeLogsLarge(home);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(String(spy.mock.calls[0][0])).toContain('are large');
      expect(String(spy.mock.calls[0][0])).toContain(join(home, 'logs'));
    });

    it('is silent when logs are under the threshold', () => {
      const home = join(tmp, 'under');
      mkdirSync(home, { recursive: true });
      seedLogs(home, 1024); // 1 KB, well under the default 500 MB
      const spy = vi
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true);

      warnIfHomeLogsLarge(home);

      expect(spy).not.toHaveBeenCalled();
    });

    it('is silent when there is no logs directory', () => {
      const home = join(tmp, 'nologs');
      mkdirSync(home, { recursive: true });
      process.env.MINIH_COPILOT_HOME_WARN_MB = '1';
      const spy = vi
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true);

      warnIfHomeLogsLarge(home);

      expect(spy).not.toHaveBeenCalled();
    });

    it("neg-control: MINIH_COPILOT_HOME_WARN_MB='0' falls back to 500, not a literal 0 threshold — stays silent", () => {
      const home = join(tmp, 'zero');
      mkdirSync(home, { recursive: true });
      // 4 KB would warn if '0' were taken literally as the threshold (4KB > 0).
      seedLogs(home, 4096);
      process.env.MINIH_COPILOT_HOME_WARN_MB = '0';
      const spy = vi
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true);

      warnIfHomeLogsLarge(home);

      expect(spy).not.toHaveBeenCalled();
    });

    it('neg-control: a non-numeric MINIH_COPILOT_HOME_WARN_MB falls back to 500 — stays silent', () => {
      const home = join(tmp, 'nan');
      mkdirSync(home, { recursive: true });
      seedLogs(home, 4096);
      process.env.MINIH_COPILOT_HOME_WARN_MB = 'not-a-number';
      const spy = vi
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true);

      warnIfHomeLogsLarge(home);

      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('buildCopilotClientOptions', () => {
    it('carries baseDirectory/gitHubToken/logLevel and preserves trace + telemetry', () => {
      const opts = buildCopilotClientOptions(
        '/home/x',
        'gho_token',
        'info',
        'http://otlp:4318',
      );
      expect(opts.baseDirectory).toBe('/home/x');
      expect(opts.gitHubToken).toBe('gho_token');
      expect(opts.logLevel).toBe('info');
      expect(typeof opts.onGetTraceContext).toBe('function');
      expect(opts.onGetTraceContext()).toBeTypeOf('object');
      expect(opts.telemetry).toEqual({ otlpEndpoint: 'http://otlp:4318' });
    });

    it('omits telemetry when no OTLP endpoint is given', () => {
      const opts = buildCopilotClientOptions('/home/x', 'gho_token', 'error');
      expect(opts.telemetry).toBeUndefined();
      expect(typeof opts.onGetTraceContext).toBe('function');
    });

    it('neg-control: a missing token yields gitHubToken: undefined (token must be wired through, never hardcoded)', () => {
      const opts = buildCopilotClientOptions('/home/x', undefined, 'info');
      expect(opts.gitHubToken).toBeUndefined();
    });
  });
});
