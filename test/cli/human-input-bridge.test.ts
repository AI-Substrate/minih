import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionSender } from '../../src/adapter/events.js';
import {
  createInputBridge,
  type InputBridge,
  type InputBridgeInput,
  type InputSubmitResult,
  synthesiseSubject,
} from '../../src/cli/human/input-bridge.js';
import { coordinationRunLocation } from '../../src/runner/index.js';

function fakeSender(returnId = 'msg-001'): {
  sender: SessionSender;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    sender: {
      send: async (text: string) => {
        calls.push(text);
        return returnId;
      },
    },
    calls,
  };
}

function makeBridge(overrides: Partial<InputBridgeInput> = {}): {
  bridge: InputBridge;
  calls: string[];
} {
  const { sender, calls } = fakeSender();
  const input: InputBridgeInput = {
    sender,
    attached: false,
    runStatus: 'active',
    ...overrides,
  };
  return { bridge: createInputBridge(input), calls };
}

describe('createInputBridge — capability derivation', () => {
  it('same-process + active + sender (non-coord) → input → session', () => {
    const { bridge } = makeBridge();
    expect(bridge.capability).toBe('input → session');
    expect(bridge.reason).toBeUndefined();
  });

  it('attached (cross-process) non-coord → input read-only — non-coordinated', () => {
    const { bridge } = makeBridge({ attached: true, sender: undefined });
    expect(bridge.capability).toBe('input read-only — non-coordinated');
    expect(bridge.reason).toBe('attached to non-coordinated agent');
  });

  it('no sender + not attached + non-coord → input read-only — non-coordinated', () => {
    const { bridge } = makeBridge({ sender: undefined });
    expect(bridge.capability).toBe('input read-only — non-coordinated');
    expect(bridge.reason).toBe('no write channel available');
  });

  it('runStatus=completed → input read-only — completed', () => {
    const { bridge } = makeBridge({ runStatus: 'completed' });
    expect(bridge.capability).toBe('input read-only — completed');
    expect(bridge.reason).toBe('run completed');
  });

  it('runStatus=failed → input read-only — completed (terminal status)', () => {
    const { bridge } = makeBridge({ runStatus: 'failed' });
    expect(bridge.capability).toBe('input read-only — completed');
  });

  it('terminal status overrides attach (completed runs read completed regardless of attach)', () => {
    const { bridge } = makeBridge({ runStatus: 'completed', attached: true });
    expect(bridge.capability).toBe('input read-only — completed');
  });
});

describe('createInputBridge — submit', () => {
  it('input → session bridge calls sender.send and returns ok with messageId', async () => {
    const { bridge, calls } = makeBridge();
    const result: InputSubmitResult = await bridge.submit('hello');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.messageId).toBe('msg-001');
    }
    expect(calls).toEqual(['hello']);
  });

  it('input → session bridge surfaces sender errors as refusals', async () => {
    const sender: SessionSender = {
      send: async () => {
        throw new Error('boom');
      },
    };
    const bridge = createInputBridge({
      sender,
      attached: false,
      runStatus: 'active',
    });
    const result = await bridge.submit('x');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('boom');
    }
  });

  it('attached non-coord read-only bridge refuses with descriptive reason', async () => {
    const { bridge } = makeBridge({ attached: true, sender: undefined });
    const result = await bridge.submit('hello');
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.reason).toBe('attached to non-coordinated agent');
  });

  it('completed bridge refuses with run-completed', async () => {
    const { bridge } = makeBridge({ runStatus: 'completed' });
    const result = await bridge.submit('hello');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('run completed');
  });
});

describe('createInputBridge — withRunStatus transition', () => {
  it('active → completed flips capability and starts refusing', async () => {
    const { bridge: live, calls } = makeBridge();
    expect(live.capability).toBe('input → session');

    const completed = live.withRunStatus('completed');
    expect(completed.capability).toBe('input read-only — completed');

    const result = await completed.submit('hello');
    expect(result.ok).toBe(false);
    expect(calls).toEqual([]); // sender never called after transition
  });

  it('attached read-only stays read-only across non-terminal runStatus changes', () => {
    const { bridge } = makeBridge({ attached: true, sender: undefined });
    const next = bridge.withRunStatus('idle');
    expect(next.capability).toBe('input read-only — non-coordinated');
  });
});

// FX008-10 — capability table coverage. Each row of workshop §4.4 gets a test.
// Coordinated rows use a real tmpdir + filesystem assertions because the
// inbox write path is the load-bearing concern of FX008.

describe('createInputBridge — FX008 capability table (5-row coverage)', () => {
  let tmp: string;
  let runDir: string;
  let agentsDir: string;
  const SLUG = 'cap-test';
  const RUN_ID = '2026-05-02T00-00-00-000Z-test';

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fx008-bridge-'));
    agentsDir = path.join(tmp, 'agents');
    runDir = path.join(agentsDir, SLUG, 'runs', RUN_ID);
    fs.mkdirSync(path.join(runDir, 'inbox', 'outside'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function makeLocation() {
    return coordinationRunLocation(SLUG, agentsDir, RUN_ID);
  }

  it('row 1 — run --human non-coord → input → session (writes via SessionSender)', async () => {
    const { sender, calls } = fakeSender('sdk-msg-1');
    const bridge = createInputBridge({
      sender,
      attached: false,
      coordinated: false,
      runDir,
      agentSlug: SLUG,
      runStatus: 'active',
    });
    expect(bridge.capability).toBe('input → session');

    const result = await bridge.submit('hi from run');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.messageId).toBe('sdk-msg-1');
    expect(calls).toEqual(['hi from run']);
  });

  it('row 2 — run --human coord (with location) → input → inbox (writes file)', async () => {
    const { sender, calls } = fakeSender();
    const bridge = createInputBridge({
      sender,
      attached: false,
      coordinated: true,
      runDir,
      agentSlug: SLUG,
      runStatus: 'active',
      location: makeLocation(),
      commandName: 'human-tui.input',
    });
    expect(bridge.capability).toBe('input → inbox');

    const result = await bridge.submit('hello inbox');
    expect(result.ok).toBe(true);
    expect(calls).toEqual([]); // SessionSender NOT called for coord path

    // Inspect on-disk inbox lane.
    const lanePath = path.join(runDir, 'inbox', 'outside', 'messages.ndjson');
    const raw = fs.readFileSync(lanePath, 'utf8').trim();
    const entries = raw.split('\n').map((l) => JSON.parse(l));
    expect(entries).toHaveLength(1);
    expect(entries[0].sender).toBe('outside');
    expect(entries[0].type).toBe('task');
    expect(entries[0].body).toBe('hello inbox');
    expect(entries[0].subject).toBe('hello inbox');
    expect(entries[0].id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/); // ULID
  });

  it('row 3 — attach coord (no sender, with location) → input → inbox', async () => {
    const bridge = createInputBridge({
      sender: undefined,
      attached: true,
      coordinated: true,
      runDir,
      agentSlug: SLUG,
      runStatus: 'active',
      location: makeLocation(),
      commandName: 'attach.input',
    });
    expect(bridge.capability).toBe('input → inbox');

    const result = await bridge.submit('hello from attach');
    expect(result.ok).toBe(true);

    const lanePath = path.join(runDir, 'inbox', 'outside', 'messages.ndjson');
    const entries = fs
      .readFileSync(lanePath, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(entries[0].body).toBe('hello from attach');
  });

  it('row 4 — attach non-coord → input read-only — non-coordinated', async () => {
    const bridge = createInputBridge({
      sender: undefined,
      attached: true,
      coordinated: false,
      runDir,
      agentSlug: SLUG,
      runStatus: 'active',
    });
    expect(bridge.capability).toBe('input read-only — non-coordinated');

    const result = await bridge.submit('would be ignored');
    expect(result.ok).toBe(false);
  });

  it('row 5 — any × terminal status → input read-only — completed', () => {
    const cases: Array<Partial<InputBridgeInput>> = [
      { attached: false, coordinated: false, runStatus: 'completed' },
      { attached: false, coordinated: true, runStatus: 'completed' },
      { attached: true, coordinated: false, runStatus: 'failed' },
      { attached: true, coordinated: true, runStatus: 'failed' },
    ];
    for (const overrides of cases) {
      const bridge = createInputBridge({
        sender: undefined,
        attached: true,
        runStatus: 'completed',
        runDir,
        agentSlug: SLUG,
        ...overrides,
      } as InputBridgeInput);
      expect(bridge.capability).toBe('input read-only — completed');
    }
  });

  it('coord without location FAILS CLOSED — never falls to SDK (companion F003)', async () => {
    const { sender, calls } = fakeSender();
    const bridge = createInputBridge({
      sender,
      attached: false,
      coordinated: true,
      runDir,
      agentSlug: SLUG,
      runStatus: 'active',
      // location intentionally omitted
    });
    // FX008 F003 fix: coordinated:true + no location MUST refuse, not
    // silently route to SessionSender. The whole point of the fix is to
    // prevent silent footer-input drift.
    expect(bridge.capability).toBe('input read-only — non-coordinated');
    expect(bridge.reason).toBe('coordinated run missing inbox location');

    const result = await bridge.submit('would be silently sent to SDK');
    expect(result.ok).toBe(false);
    expect(calls).toEqual([]); // sender NEVER called
  });

  it('--read-only equivalent (no location) on attached coord → read-only', () => {
    const bridge = createInputBridge({
      sender: undefined,
      attached: true,
      coordinated: true,
      runDir,
      agentSlug: SLUG,
      runStatus: 'active',
      // location withheld to simulate --read-only
    });
    expect(bridge.capability).toBe('input read-only — non-coordinated');
  });
});

describe('synthesiseSubject', () => {
  it('passes short single-line bodies through unchanged', () => {
    expect(synthesiseSubject('hello world')).toBe('hello world');
  });

  it('truncates at last word boundary when over 60 chars', () => {
    const body =
      'this is a long body that goes well past sixty characters and needs truncation';
    const subject = synthesiseSubject(body);
    expect(subject.length).toBeLessThanOrEqual(60);
    expect(body.startsWith(subject)).toBe(true);
    expect(subject.endsWith(' ')).toBe(false);
  });

  it('takes only the first line for multi-line bodies', () => {
    expect(synthesiseSubject('line one\nline two\nline three')).toBe(
      'line one',
    );
  });

  it('handles a long first line with no spaces (hard truncate at 60)', () => {
    const body = 'a'.repeat(100);
    expect(synthesiseSubject(body)).toBe('a'.repeat(60));
  });

  it('handles empty body', () => {
    expect(synthesiseSubject('')).toBe('');
  });

  it('handles \\r\\n line endings', () => {
    expect(synthesiseSubject('first\r\nsecond')).toBe('first');
  });
});
