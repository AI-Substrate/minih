import { describe, expect, it } from 'vitest';
import {
  coordinationMessagesReceived,
  coordinationMessagesSent,
  coordinationStateTransitions,
  eventCount,
  promptTokens,
  runCount,
  runDuration,
  sessionDuration,
  toolCallCount,
  validationCount,
} from '../../src/telemetry/metrics.js';

describe('telemetry/metrics', () => {
  it('all metric instruments are defined', () => {
    // Verify instruments exist (they're OTel API no-ops when no provider is registered)
    expect(runDuration).toBeDefined();
    expect(runCount).toBeDefined();
    expect(toolCallCount).toBeDefined();
    expect(eventCount).toBeDefined();
    expect(validationCount).toBeDefined();
    expect(promptTokens).toBeDefined();
    expect(sessionDuration).toBeDefined();
  });

  it('histogram record does not throw', () => {
    expect(() => runDuration.record(1000)).not.toThrow();
    expect(() =>
      runDuration.record(500, { 'agent.slug': 'test', result: 'completed' }),
    ).not.toThrow();
  });

  it('counter add does not throw', () => {
    expect(() => runCount.add(1)).not.toThrow();
    expect(() =>
      runCount.add(1, { 'agent.slug': 'test', result: 'failed' }),
    ).not.toThrow();
  });

  it('validation counter accepts valid attribute', () => {
    expect(() =>
      validationCount.add(1, { valid: true, type: 'user' }),
    ).not.toThrow();
    expect(() =>
      validationCount.add(1, { valid: false, type: 'system' }),
    ).not.toThrow();
  });

  it('coordination counters are defined and do not throw', () => {
    expect(coordinationMessagesSent).toBeDefined();
    expect(coordinationMessagesReceived).toBeDefined();
    expect(coordinationStateTransitions).toBeDefined();
    expect(() =>
      coordinationMessagesSent.add(1, { type: 'task', sender: 'outside' }),
    ).not.toThrow();
    expect(() =>
      coordinationMessagesReceived.add(1, { type: 'task' }),
    ).not.toThrow();
    expect(() =>
      coordinationStateTransitions.add(1, { from: 'idle', to: 'in-progress' }),
    ).not.toThrow();
  });
});
