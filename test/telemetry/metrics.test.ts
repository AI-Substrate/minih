import { describe, it, expect } from 'vitest';
import {
  runDuration,
  runCount,
  toolCallCount,
  eventCount,
  validationCount,
  promptTokens,
  sessionDuration,
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
});
