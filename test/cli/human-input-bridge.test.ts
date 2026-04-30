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
  it('same-process + active + sender → input available', () => {
    const { bridge } = makeBridge();
    expect(bridge.capability).toBe('input available');
    expect(bridge.reason).toBeUndefined();
  });

  it('attached (cross-process) → input read-only with attached-read-only reason', () => {
    const { bridge } = makeBridge({ attached: true, sender: undefined });
    expect(bridge.capability).toBe('input read-only');
    expect(bridge.reason).toBe('attached-read-only');
  });

  it('no sender (even when not attached) → input read-only', () => {
    const { bridge } = makeBridge({ sender: undefined });
    expect(bridge.capability).toBe('input read-only');
    expect(bridge.reason).toBe('attached-read-only');
  });

  it('runStatus=completed → completed', () => {
    const { bridge } = makeBridge({ runStatus: 'completed' });
    expect(bridge.capability).toBe('completed');
    expect(bridge.reason).toBe('run completed');
  });

  it('runStatus=failed → completed (terminal status)', () => {
    const { bridge } = makeBridge({ runStatus: 'failed' });
    expect(bridge.capability).toBe('completed');
  });

  it('terminal status overrides attach (even attached completed runs read completed)', () => {
    const { bridge } = makeBridge({ runStatus: 'completed', attached: true });
    expect(bridge.capability).toBe('completed');
  });
});

describe('createInputBridge — submit', () => {
  it('input-available bridge calls sender.send and returns ok with messageId', async () => {
    const { bridge, calls } = makeBridge();
    const result: InputSubmitResult = await bridge.submit('hello');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.messageId).toBe('msg-001');
    }
    expect(calls).toEqual(['hello']);
  });

  it('input-available bridge surfaces sender errors as refusals', async () => {
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

  it('attached-read-only bridge refuses with attached-read-only', async () => {
    const { bridge } = makeBridge({ attached: true, sender: undefined });
    const result = await bridge.submit('hello');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('attached-read-only');
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
    expect(live.capability).toBe('input available');

    const completed = live.withRunStatus('completed');
    expect(completed.capability).toBe('completed');

    const result = await completed.submit('hello');
    expect(result.ok).toBe(false);
    expect(calls).toEqual([]); // sender never called after transition
  });

  it('attached read-only stays read-only across non-terminal runStatus changes', () => {
    const { bridge } = makeBridge({ attached: true, sender: undefined });
    const next = bridge.withRunStatus('idle');
    expect(next.capability).toBe('input read-only');
  });
});
