import { describe, expect, it } from 'vitest';
import {
  ErrorCodes,
  formatError,
  formatSuccess,
} from '../../src/cli/output.js';

describe('output envelope', () => {
  it('formatSuccess produces ok envelope with data', () => {
    const env = formatSuccess('list', { agents: [], count: 0 });
    expect(env.command).toBe('list');
    expect(env.status).toBe('ok');
    expect(env.timestamp).toBeDefined();
    expect(env.data).toEqual({ agents: [], count: 0 });
    expect(env.error).toBeUndefined();
  });

  it('formatSuccess supports degraded status', () => {
    const env = formatSuccess('run', { result: 'degraded' }, 'degraded');
    expect(env.status).toBe('degraded');
  });

  it('formatError produces error envelope with code and message', () => {
    const env = formatError(
      'run',
      ErrorCodes.AGENT_NOT_FOUND,
      'Agent "foo" not found.',
    );
    expect(env.command).toBe('run');
    expect(env.status).toBe('error');
    expect(env.error?.code).toBe('E121');
    expect(env.error?.message).toBe('Agent "foo" not found.');
    expect(env.data).toBeUndefined();
  });

  it('formatError includes optional details', () => {
    const env = formatError('run', ErrorCodes.AGENT_AUTH_MISSING, 'No token', {
      fix: 'export GH_TOKEN=$(gh auth token)',
    });
    expect(env.error?.details).toEqual({
      fix: 'export GH_TOKEN=$(gh auth token)',
    });
  });

  it('timestamp is ISO-8601', () => {
    const env = formatSuccess('test', {});
    expect(env.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
