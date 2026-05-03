import { describe, expect, it } from 'vitest';
import {
  FakeAgentPackFetcher,
  GitHubAgentPackFetcher,
} from '../../../src/runner/agent-pack/fetcher.js';

describe('FakeAgentPackFetcher', () => {
  it('returns the preset {commitSha, tarball} for a registered (url, ref)', async () => {
    const fake = new FakeAgentPackFetcher();
    const tarball = Buffer.from('fake tarball');
    fake.setSuccess('github:foo/bar', 'main', {
      commitSha: 'abc123',
      tarball,
    });
    const result = await fake.fetchTarball('github:foo/bar', 'main');
    expect(result.commitSha).toBe('abc123');
    expect(result.tarball.equals(tarball)).toBe(true);
  });

  it('rejects with descriptive error for an unregistered (url, ref)', async () => {
    const fake = new FakeAgentPackFetcher();
    await expect(fake.fetchTarball('github:foo/bar', 'main')).rejects.toThrow(
      /foo\/bar.*main/,
    );
  });

  it('records call history for assertions', async () => {
    const fake = new FakeAgentPackFetcher();
    fake.setSuccess('github:a/b', 'main', {
      commitSha: 'x',
      tarball: Buffer.alloc(0),
    });
    fake.setSuccess('github:c/d', 'dev', {
      commitSha: 'y',
      tarball: Buffer.alloc(0),
    });
    await fake.fetchTarball('github:a/b', 'main');
    await fake.fetchTarball('github:c/d', 'dev');
    expect(fake.callHistory).toEqual([
      { url: 'github:a/b', ref: 'main' },
      { url: 'github:c/d', ref: 'dev' },
    ]);
  });

  it('exposes a call counter', async () => {
    const fake = new FakeAgentPackFetcher();
    fake.setSuccess('github:a/b', 'main', {
      commitSha: 'x',
      tarball: Buffer.alloc(0),
    });
    expect(fake.callCount).toBe(0);
    await fake.fetchTarball('github:a/b', 'main');
    expect(fake.callCount).toBe(1);
    await fake.fetchTarball('github:a/b', 'main');
    expect(fake.callCount).toBe(2);
  });

  it('overrides preset response on second `setSuccess` for retry/upgrade simulations', async () => {
    const fake = new FakeAgentPackFetcher();
    fake.setSuccess('github:a/b', 'main', {
      commitSha: 'first',
      tarball: Buffer.alloc(0),
    });
    fake.setSuccess('github:a/b', 'main', {
      commitSha: 'second',
      tarball: Buffer.alloc(0),
    });
    const result = await fake.fetchTarball('github:a/b', 'main');
    expect(result.commitSha).toBe('second');
  });

  it('honors `setFailure` to inject errors for testing', async () => {
    const fake = new FakeAgentPackFetcher();
    fake.setFailure('github:a/b', 'main', new Error('synthetic E181'));
    await expect(fake.fetchTarball('github:a/b', 'main')).rejects.toThrow(
      /synthetic E181/,
    );
  });
});

describe('GitHubAgentPackFetcher (Phase 1 stub)', () => {
  it('exists as a class so consumers can name the type in Phase 2/3', () => {
    expect(GitHubAgentPackFetcher).toBeDefined();
    expect(typeof GitHubAgentPackFetcher).toBe('function');
  });

  it('throws "not implemented" — real fetch lands in Phase 3.2', async () => {
    const real = new GitHubAgentPackFetcher();
    await expect(real.fetchTarball('github:foo/bar', 'main')).rejects.toThrow(
      /not implemented|Phase 3/i,
    );
  });
});
