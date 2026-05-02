import { describe, expect, it } from 'vitest';
import type { SessionSender } from '../../src/adapter/events.js';
import {
  createInputBridge,
  type InputBridge,
  type InputBridgeInput,
  type InputSubmitResult,
} from '../../src/cli/human/input-bridge.js';

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
