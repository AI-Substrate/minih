import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  coordinationRunLocation,
  watermarkPath,
} from '../../src/runner/folder.js';
import {
  assertPathInsideAgentsDir,
  CoordinationPathEscapeError,
  defaultForwarderWatermark,
  InvalidForwarderWatermarkError,
  readForwarderWatermark,
  updateForwarderWatermark,
  withInboxOffset,
  withStateFingerprint,
  writeForwarderWatermark,
} from '../../src/runner/forwarder-watermark.js';

let tmpDir: string;
let agentsDir: string;
const slug = 'code-review';
const runId = 'run-123';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-watermark-'));
  agentsDir = path.join(tmpDir, 'agents');
  fs.mkdirSync(agentsDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function location() {
  return coordinationRunLocation(slug, agentsDir, runId);
}

describe('forwarder watermark', () => {
  it('returns explicit default progress when the watermark is absent', () => {
    const loaded = readForwarderWatermark(location());

    expect(loaded.value).toEqual(defaultForwarderWatermark());
    expect(loaded.recoveredFromCorruption).toBe(false);
    expect(loaded.path).toBe(watermarkPath(location()));
  });

  it('writes normalized progress with atomic writer semantics', () => {
    writeForwarderWatermark(
      location(),
      withStateFingerprint(
        withInboxOffset(defaultForwarderWatermark(), 42),
        'outside-state-v1',
      ),
    );

    const target = watermarkPath(location());
    expect(fs.readdirSync(path.dirname(target))).toEqual([
      'sdk-watermark.json',
    ]);
    expect(readForwarderWatermark(location()).value).toEqual({
      version: 1,
      inbox: { outsideOffset: 42 },
      state: { outsideFingerprint: 'outside-state-v1' },
    });
  });

  it('updates progress from the current durable value', () => {
    writeForwarderWatermark(
      location(),
      withInboxOffset(defaultForwarderWatermark(), 5),
    );

    const loaded = updateForwarderWatermark(location(), (current) =>
      withStateFingerprint(withInboxOffset(current, 10), 'next-state'),
    );

    expect(loaded.value).toEqual({
      version: 1,
      inbox: { outsideOffset: 10 },
      state: { outsideFingerprint: 'next-state' },
    });
  });

  it('keeps progress isolated between runs of the same agent', () => {
    const otherLocation = coordinationRunLocation(slug, agentsDir, 'run-456');
    writeForwarderWatermark(
      location(),
      withInboxOffset(defaultForwarderWatermark(), 5),
    );
    writeForwarderWatermark(
      otherLocation,
      withInboxOffset(defaultForwarderWatermark(), 10),
    );

    expect(readForwarderWatermark(location()).value.inbox.outsideOffset).toBe(
      5,
    );
    expect(
      readForwarderWatermark(otherLocation).value.inbox.outsideOffset,
    ).toBe(10);
  });

  it('recovers corrupt data as empty progress and reports the reason', () => {
    const target = watermarkPath(location());
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '{not-json');

    const loaded = readForwarderWatermark(location());

    expect(loaded.value).toEqual(defaultForwarderWatermark());
    expect(loaded.recoveredFromCorruption).toBe(true);
    expect(loaded.recoveryReason).toMatch(/json/i);
  });

  it('rejects invalid progress instead of persisting it', () => {
    expect(() => withInboxOffset(defaultForwarderWatermark(), -1)).toThrow(
      InvalidForwarderWatermarkError,
    );
    expect(() =>
      writeForwarderWatermark(location(), {
        version: 1,
        inbox: { outsideOffset: Number.NaN },
        state: { outsideFingerprint: null },
      }),
    ).toThrow(InvalidForwarderWatermarkError);
  });

  it('rejects watermark parent symlink escapes', () => {
    const escaped = path.join(tmpDir, 'escaped');
    fs.mkdirSync(escaped);
    const runDir = path.join(agentsDir, slug, 'runs', runId);
    fs.mkdirSync(runDir, { recursive: true });
    fs.symlinkSync(escaped, path.join(runDir, 'state'));

    expect(() =>
      writeForwarderWatermark(location(), defaultForwarderWatermark()),
    ).toThrow(CoordinationPathEscapeError);
  });

  it('rejects existing watermark file symlink escapes on read', () => {
    const escaped = path.join(tmpDir, 'escaped');
    fs.mkdirSync(escaped);
    const externalWatermark = path.join(escaped, 'sdk-watermark.json');
    fs.writeFileSync(
      externalWatermark,
      JSON.stringify(defaultForwarderWatermark()),
    );

    const stateDir = path.dirname(watermarkPath(location()));
    fs.mkdirSync(stateDir, { recursive: true });
    fs.symlinkSync(externalWatermark, watermarkPath(location()));

    expect(() => readForwarderWatermark(location())).toThrow(
      CoordinationPathEscapeError,
    );
  });

  it('allows contained paths and rejects lexical escapes', () => {
    const target = watermarkPath(location());
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(defaultForwarderWatermark()));

    expect(() => assertPathInsideAgentsDir(target, agentsDir)).not.toThrow();
    expect(() =>
      assertPathInsideAgentsDir(path.join(tmpDir, 'outside.json'), agentsDir),
    ).toThrow(CoordinationPathEscapeError);
  });
});
