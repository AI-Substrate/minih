import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  initTelemetry,
  isTelemetryEnabled,
  shutdownTelemetry,
  withTelemetry,
} from '../../src/telemetry/init.js';

describe('telemetry/init', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.MINIH_TELEMETRY;
    delete process.env.MINIH_TELEMETRY_VERBOSE;
  });

  afterEach(async () => {
    await shutdownTelemetry();
    process.env = { ...originalEnv };
  });

  it('isTelemetryEnabled returns false when MINIH_TELEMETRY is not set', () => {
    expect(isTelemetryEnabled()).toBe(false);
  });

  it('isTelemetryEnabled returns true when MINIH_TELEMETRY=true', () => {
    process.env.MINIH_TELEMETRY = 'true';
    expect(isTelemetryEnabled()).toBe(true);
  });

  it('isTelemetryEnabled returns false for non-true values', () => {
    process.env.MINIH_TELEMETRY = '1';
    expect(isTelemetryEnabled()).toBe(false);
    process.env.MINIH_TELEMETRY = 'yes';
    expect(isTelemetryEnabled()).toBe(false);
  });

  it('initTelemetry is safe to call when disabled', () => {
    // Should not throw
    initTelemetry();
  });

  it('initTelemetry starts SDK when enabled', async () => {
    process.env.MINIH_TELEMETRY = 'true';
    // Should not throw
    initTelemetry();
    // Calling again should be idempotent
    initTelemetry();
    await shutdownTelemetry();
  });

  it('shutdownTelemetry is safe to call when not initialized', async () => {
    // Should not throw
    await shutdownTelemetry();
  });

  it('withTelemetry wraps function and returns result', async () => {
    const result = await withTelemetry(async () => 42);
    expect(result).toBe(42);
  });

  it('withTelemetry propagates errors', async () => {
    await expect(
      withTelemetry(async () => {
        throw new Error('test error');
      }),
    ).rejects.toThrow('test error');
  });
});
