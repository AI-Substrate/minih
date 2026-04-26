import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { watermarkPath } from '../../src/runner/folder.js';
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

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-watermark-'));
  agentsDir = path.join(tmpDir, 'agents');
  fs.mkdirSync(agentsDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function location() {
  return { slug: 'code-review', agentsDir };
}

describe('forwarder watermark', () => {
  it('returns explicit default progress when the watermark is absent', () => {
    const loaded = readForwarderWatermark(location());

    expect(loaded.value).toEqual(defaultForwarderWatermark());
    expect(loaded.recoveredFromCorruption).toBe(false);
    expect(loaded.path).toBe(watermarkPath('code-review', agentsDir));
  });

  it('writes normalized progress with atomic writer semantics', () => {
    writeForwarderWatermark(
      location(),
      withStateFingerprint(
        withInboxOffset(defaultForwarderWatermark(), 42),
        'outside-state-v1',
      ),
    );

    const target = watermarkPath('code-review', agentsDir);
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

  it('recovers corrupt data as empty progress and reports the reason', () => {
    const target = watermarkPath('code-review', agentsDir);
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
    const agentDir = path.join(agentsDir, 'code-review');
    fs.mkdirSync(agentDir);
    fs.symlinkSync(escaped, path.join(agentDir, 'state'));

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

    const stateDir = path.dirname(watermarkPath('code-review', agentsDir));
    fs.mkdirSync(stateDir, { recursive: true });
    fs.symlinkSync(externalWatermark, watermarkPath('code-review', agentsDir));

    expect(() => readForwarderWatermark(location())).toThrow(
      CoordinationPathEscapeError,
    );
  });

  it('allows contained paths and rejects lexical escapes', () => {
    const target = watermarkPath('code-review', agentsDir);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(defaultForwarderWatermark()));

    expect(() => assertPathInsideAgentsDir(target, agentsDir)).not.toThrow();
    expect(() =>
      assertPathInsideAgentsDir(path.join(tmpDir, 'outside.json'), agentsDir),
    ).toThrow(CoordinationPathEscapeError);
  });
});
