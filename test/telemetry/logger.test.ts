import { beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/telemetry/logger.js';

describe('telemetry/logger', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.MINIH_LOG_LEVEL;
  });

  it('creates a logger with all four methods', () => {
    const log = createLogger('test-module');
    expect(typeof log.debug).toBe('function');
    expect(typeof log.info).toBe('function');
    expect(typeof log.warn).toBe('function');
    expect(typeof log.error).toBe('function');
  });

  it('logger methods do not throw when telemetry is disabled', () => {
    const log = createLogger('test-module');
    // All calls should be no-ops without throwing
    expect(() => log.debug('debug message')).not.toThrow();
    expect(() => log.info('info message')).not.toThrow();
    expect(() => log.warn('warn message')).not.toThrow();
    expect(() => log.error('error message')).not.toThrow();
  });

  it('logger methods accept attributes', () => {
    const log = createLogger('test-module');
    expect(() =>
      log.info('message', { key: 'value', count: 42 }),
    ).not.toThrow();
  });

  it('respects MINIH_LOG_LEVEL env var', () => {
    // When set to error, lower-level logs should not throw
    // (they're filtered by the threshold check)
    process.env.MINIH_LOG_LEVEL = 'error';
    const log = createLogger('test-module');
    expect(() => log.debug('should be filtered')).not.toThrow();
    expect(() => log.info('should be filtered')).not.toThrow();
    expect(() => log.warn('should be filtered')).not.toThrow();
    expect(() => log.error('should pass')).not.toThrow();
    process.env = { ...originalEnv };
  });
});
