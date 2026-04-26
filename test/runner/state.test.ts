/**
 * State helpers — round-trip, lazy-default, corruption, concurrency, line-size.
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendHistory,
  HistoryLineTooLargeError,
  InvalidSlugError,
  readStateLazy,
  StateCorruptError,
  writeState,
} from '../../src/runner/state.js';
import type { InsideState, OutsideState } from '../../src/runner/types.js';

let agentsDir: string;
const SLUG = 'fixture-agent';

beforeEach(() => {
  agentsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-state-'));
  fs.mkdirSync(path.join(agentsDir, SLUG), { recursive: true });
});

afterEach(() => {
  fs.rmSync(agentsDir, { recursive: true, force: true });
});

describe('readStateLazy()', () => {
  it('returns a synthetic default when file is absent (does not write)', () => {
    const before = fs.existsSync(path.join(agentsDir, SLUG, 'state'));
    const result = readStateLazy('outside', SLUG, agentsDir);
    expect(result.status).toBe('idle');
    expect(result.data).toEqual({});
    expect(result.updatedBy).toBe('outside');
    // Lazy default is never persisted — directory should still not exist.
    expect(fs.existsSync(path.join(agentsDir, SLUG, 'state'))).toBe(before);
  });

  it('round-trips a written state', () => {
    const state: OutsideState = {
      status: 'in-progress',
      data: { milestone: 2 },
      updatedAt: '2026-04-26T05:00:00.000Z',
      updatedBy: 'outside',
    };
    writeState('outside', SLUG, agentsDir, state);
    expect(readStateLazy('outside', SLUG, agentsDir)).toEqual(state);
  });

  it('throws StateCorruptError on invalid JSON', () => {
    const file = path.join(agentsDir, SLUG, 'state', 'outside.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{not valid json');
    expect(() => readStateLazy('outside', SLUG, agentsDir)).toThrow(
      StateCorruptError,
    );
  });

  it('throws StateCorruptError when required field is missing', () => {
    const file = path.join(agentsDir, SLUG, 'state', 'outside.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({ status: 'idle', updatedBy: 'outside' }),
    ); // missing data + updatedAt
    expect(() => readStateLazy('outside', SLUG, agentsDir)).toThrow(
      /missing required field/,
    );
  });

  it('throws StateCorruptError on updatedBy mismatch', () => {
    const file = path.join(agentsDir, SLUG, 'state', 'outside.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        status: 'idle',
        data: {},
        updatedAt: '2026-04-26T05:00:00.000Z',
        updatedBy: 'inside', // wrong side
      }),
    );
    expect(() => readStateLazy('outside', SLUG, agentsDir)).toThrow(
      /updatedBy mismatch/,
    );
  });

  it('throws StateCorruptError when file content is not an object', () => {
    const file = path.join(agentsDir, SLUG, 'state', 'outside.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '[]');
    expect(() => readStateLazy('outside', SLUG, agentsDir)).toThrow(
      StateCorruptError,
    );
  });

  // F002: type-check field values, not just key presence.
  it('throws StateCorruptError when status is not a string (F002)', () => {
    const file = path.join(agentsDir, SLUG, 'state', 'outside.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        status: 42,
        data: {},
        updatedAt: '2026-04-26T05:00:00.000Z',
        updatedBy: 'outside',
      }),
    );
    expect(() => readStateLazy('outside', SLUG, agentsDir)).toThrow(
      /'status' must be a non-empty string/,
    );
  });

  it('throws StateCorruptError when data is not an object (F002)', () => {
    const file = path.join(agentsDir, SLUG, 'state', 'outside.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        status: 'idle',
        data: [],
        updatedAt: '2026-04-26T05:00:00.000Z',
        updatedBy: 'outside',
      }),
    );
    expect(() => readStateLazy('outside', SLUG, agentsDir)).toThrow(
      /'data' must be a JSON object/,
    );
  });

  it('throws StateCorruptError when updatedAt is not a parseable date-time (F002)', () => {
    const file = path.join(agentsDir, SLUG, 'state', 'outside.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        status: 'idle',
        data: {},
        updatedAt: 'not-a-date',
        updatedBy: 'outside',
      }),
    );
    expect(() => readStateLazy('outside', SLUG, agentsDir)).toThrow(
      /not a parseable date-time/,
    );
  });

  it('throws InvalidSlugError on bad slug', () => {
    expect(() => readStateLazy('outside', '..', agentsDir)).toThrow(
      InvalidSlugError,
    );
    expect(() => readStateLazy('outside', 'a/b', agentsDir)).toThrow(
      InvalidSlugError,
    );
  });
});

describe('writeState()', () => {
  it('creates the parent directory if missing', () => {
    const state: InsideState = {
      status: 'reviewing',
      data: {},
      updatedAt: '2026-04-26T05:00:00.000Z',
      updatedBy: 'inside',
    };
    writeState('inside', SLUG, agentsDir, state);
    const file = path.join(agentsDir, SLUG, 'state', 'inside.json');
    expect(fs.existsSync(file)).toBe(true);
  });

  it('10 concurrent writes leave the file with one of the payloads (set-membership)', async () => {
    const candidates = Array.from(
      { length: 10 },
      (_, i): InsideState => ({
        status: 'in-progress',
        data: { i },
        updatedAt: `2026-04-26T05:00:00.${String(i).padStart(3, '0')}Z`,
        updatedBy: 'inside',
      }),
    );
    await Promise.all(
      candidates.map((c) =>
        Promise.resolve().then(() => writeState('inside', SLUG, agentsDir, c)),
      ),
    );
    const final = readStateLazy('inside', SLUG, agentsDir);
    expect(candidates.map((c) => c.data.i)).toContain(final.data.i);
  });

  it('throws InvalidSlugError on bad slug', () => {
    const state: OutsideState = {
      status: 'idle',
      data: {},
      updatedAt: '2026-04-26T05:00:00.000Z',
      updatedBy: 'outside',
    };
    expect(() => writeState('outside', '../etc', agentsDir, state)).toThrow(
      InvalidSlugError,
    );
  });
});

describe('appendHistory()', () => {
  it('appends a single line and round-trips via NDJSON parse', () => {
    appendHistory(SLUG, agentsDir, {
      ts: '2026-04-26T05:00:00.000Z',
      side: 'outside',
      from: 'idle',
      to: 'in-progress',
      reason: null,
      peerStateAtTime: { status: 'idle' },
    });
    const file = path.join(agentsDir, SLUG, 'state', 'history.ndjson');
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({
      side: 'outside',
      from: 'idle',
      to: 'in-progress',
    });
  });

  it('auto-populates peerStateAtTime from the peer side when omitted', () => {
    // Seed inside state so peer snapshot is non-default.
    writeState('inside', SLUG, agentsDir, {
      status: 'reviewing',
      data: {},
      updatedAt: '2026-04-26T05:00:00.000Z',
      updatedBy: 'inside',
    });

    appendHistory(SLUG, agentsDir, {
      ts: '2026-04-26T05:00:01.000Z',
      side: 'outside',
      from: 'idle',
      to: 'done',
      reason: 'milestone signed off',
      // peerStateAtTime intentionally omitted
    });

    const file = path.join(agentsDir, SLUG, 'state', 'history.ndjson');
    const entry = JSON.parse(fs.readFileSync(file, 'utf8').trim());
    expect(entry.peerStateAtTime).toEqual({ status: 'reviewing' });
  });

  it('records peerStateAtTime: idle for first-ever transition (no peer file)', () => {
    appendHistory(SLUG, agentsDir, {
      ts: '2026-04-26T05:00:00.000Z',
      side: 'outside',
      from: 'idle',
      to: 'in-progress',
      reason: null,
      // peerStateAtTime omitted; inside.json does not exist
    });
    const file = path.join(agentsDir, SLUG, 'state', 'history.ndjson');
    const entry = JSON.parse(fs.readFileSync(file, 'utf8').trim());
    expect(entry.peerStateAtTime).toEqual({ status: 'idle' });
  });

  it('rejects oversize history line (> PIPE_BUF)', () => {
    expect(() =>
      appendHistory(SLUG, agentsDir, {
        ts: '2026-04-26T05:00:00.000Z',
        side: 'outside',
        from: 'idle',
        to: 'in-progress',
        reason: 'x'.repeat(5000), // way over PIPE_BUF
        peerStateAtTime: { status: 'idle' },
      }),
    ).toThrow(HistoryLineTooLargeError);
  });

  it('survives 100 parallel appends — exactly 100 lines, all valid JSON', async () => {
    await Promise.all(
      Array.from({ length: 100 }, async (_, i) => {
        appendHistory(SLUG, agentsDir, {
          ts: `2026-04-26T05:00:00.${String(i).padStart(3, '0')}Z`,
          side: 'outside',
          from: 'idle',
          to: 'in-progress',
          reason: `step-${i}`,
          peerStateAtTime: { status: 'idle' },
        });
      }),
    );
    const file = path.join(agentsDir, SLUG, 'state', 'history.ndjson');
    const content = await fsp.readFile(file, 'utf8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(100);
    const parsed = lines.map((l) => JSON.parse(l));
    const reasons = new Set(parsed.map((p) => p.reason));
    expect(reasons.size).toBe(100);
  });

  it('throws InvalidSlugError on bad slug', () => {
    expect(() =>
      appendHistory('..', agentsDir, {
        ts: '2026-04-26T05:00:00.000Z',
        side: 'outside',
        from: 'idle',
        to: 'in-progress',
        reason: null,
        peerStateAtTime: { status: 'idle' },
      }),
    ).toThrow(InvalidSlugError);
  });
});

describe('no-rule-engine guarantee', () => {
  it('source file contains no rule-engine keywords (strip comments first)', async () => {
    const src = await fsp.readFile(
      path.join(__dirname, '../../src/runner/state.ts'),
      'utf8',
    );
    // Strip block comments AND single-line comments so JSDoc that legitimately
    // names the absent feature ("no requiresPeer enforcement") doesn't fail
    // the grep for the actual code-path absence.
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(codeOnly).not.toMatch(/requiresPeer/);
    expect(codeOnly).not.toMatch(/transitionAllowed|isTransitionAllowed/);
    expect(codeOnly).not.toMatch(/\bgate\b/);
  });
});
