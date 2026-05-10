import { describe, expect, it, vi } from 'vitest';
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

describe('GitHubAgentPackFetcher (Phase 3 real impl — T005)', () => {
  // Helpers --------------------------------------------------------------

  /** Build a Response that simulates a successful GitHub tarball fetch. */
  function okResponse(opts: {
    body: Buffer | Uint8Array;
    contentLength?: number;
  }): Response {
    const headers = new Headers();
    if (opts.contentLength !== undefined) {
      headers.set('content-length', String(opts.contentLength));
    }
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(opts.body));
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers,
    });
  }

  /** Build a Response with a JSON body — used for the commits API. */
  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  function errorResponse(status: number, statusText: string): Response {
    return new Response(null, { status, statusText });
  }

  /**
   * Smart mock-fetch: routes calls based on URL pattern.
   *  - `/commits/<ref>` → returns `{sha: <sha>}`
   *  - `/tarball/<sha>` → returns the tarball Response
   *
   * Either function can be a `Response` or `(url) => Response`. Used by
   * happy-path tests that need both API calls to succeed in sequence.
   */
  function makeRoutingFetch(
    sha: string,
    tarballRespOrFactory:
      | Response
      | ((url: string) => Response | Promise<Response>),
  ): (url: string | URL, init?: RequestInit) => Promise<Response> {
    return async (input: string | URL, _init?: RequestInit) => {
      const url = input.toString();
      if (url.includes('/commits/')) {
        return jsonResponse({ sha });
      }
      if (url.includes('/tarball/')) {
        return typeof tarballRespOrFactory === 'function'
          ? await tarballRespOrFactory(url)
          : tarballRespOrFactory;
      }
      throw new Error(`unexpected fetch URL: ${url}`);
    };
  }

  // Tests ---------------------------------------------------------------

  it('(1) happy path — commits API resolves SHA + tarball download returns {commitSha, tarball}', async () => {
    const tarballBytes = Buffer.from('fake tar content', 'utf-8');
    const sha = '1234567890abcdef1234567890abcdef12345678';
    const fetchSpy = vi.fn(
      makeRoutingFetch(sha, () => okResponse({ body: tarballBytes })),
    );
    const fetcher = new GitHubAgentPackFetcher({ fetchImpl: fetchSpy });
    const result = await fetcher.fetchTarball('github:foo/bar', 'main');
    expect(result.commitSha).toBe(sha);
    expect(Buffer.compare(result.tarball, tarballBytes)).toBe(0);
  });

  it('(2) commits API 404 → E181 (ref does not exist)', async () => {
    const fetchSpy = vi.fn(async (input: string | URL) => {
      if (input.toString().includes('/commits/')) {
        return errorResponse(404, 'Not Found');
      }
      return errorResponse(500, 'unreachable');
    });
    const fetcher = new GitHubAgentPackFetcher({ fetchImpl: fetchSpy });
    await expect(
      fetcher.fetchTarball('github:foo/bar', 'main'),
    ).rejects.toThrow(/\(E181\).*ref resolution.*404/);
  });

  it('(3) tarball 403 (rate-limit) → E181', async () => {
    const sha = 'a'.repeat(40);
    const fetchSpy = vi.fn(async (input: string | URL) => {
      if (input.toString().includes('/commits/')) {
        return jsonResponse({ sha });
      }
      return errorResponse(403, 'rate limit exceeded');
    });
    const fetcher = new GitHubAgentPackFetcher({ fetchImpl: fetchSpy });
    await expect(
      fetcher.fetchTarball('github:foo/bar', 'main'),
    ).rejects.toThrow(/\(E181\).*403/);
  });

  it('(4) tarball 500 → E181 with no retry', async () => {
    const sha = 'a'.repeat(40);
    const fetchSpy = vi.fn(async (input: string | URL) => {
      if (input.toString().includes('/commits/')) {
        return jsonResponse({ sha });
      }
      return errorResponse(500, 'Internal Server Error');
    });
    const fetcher = new GitHubAgentPackFetcher({ fetchImpl: fetchSpy });
    await expect(
      fetcher.fetchTarball('github:foo/bar', 'main'),
    ).rejects.toThrow(/\(E181\).*500/);
    expect(fetchSpy).toHaveBeenCalledTimes(2); // 1 commits + 1 tarball, no retry
  });

  it('(5) network TypeError on commits API → E181', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const fetcher = new GitHubAgentPackFetcher({ fetchImpl: fetchSpy });
    await expect(
      fetcher.fetchTarball('github:foo/bar', 'main'),
    ).rejects.toThrow(/\(E181\).*network error|fetch failed/);
  });

  it('(6) tarball Content-Length 11 MB → E182 too large BEFORE body read', async () => {
    const sha = 'a'.repeat(40);
    const fetchSpy = vi.fn(
      makeRoutingFetch(sha, () =>
        okResponse({
          body: Buffer.alloc(0),
          contentLength: 11 * 1024 * 1024,
        }),
      ),
    );
    const fetcher = new GitHubAgentPackFetcher({ fetchImpl: fetchSpy });
    await expect(
      fetcher.fetchTarball('github:foo/bar', 'main'),
    ).rejects.toThrow(/too large \(E182\).*Content-Length/);
  });

  it('(7) streamed body > 10 MB without Content-Length → E182 too large mid-stream', async () => {
    const sha = 'b'.repeat(40);
    const fetchSpy = vi.fn(
      makeRoutingFetch(sha, () => okResponse({ body: Buffer.alloc(2049) })),
    );
    const fetcher = new GitHubAgentPackFetcher({
      fetchImpl: fetchSpy,
      maxBytes: 2048,
    });
    await expect(
      fetcher.fetchTarball('github:foo/bar', 'main'),
    ).rejects.toThrow(/too large \(E182\).*streamed/);
  });

  it('(8) commits API returns body without sha → E181 invalid response', async () => {
    const fetchSpy = vi.fn(async (input: string | URL) => {
      if (input.toString().includes('/commits/')) {
        return jsonResponse({ message: 'something but no sha' });
      }
      return errorResponse(500, 'unreachable');
    });
    const fetcher = new GitHubAgentPackFetcher({ fetchImpl: fetchSpy });
    await expect(
      fetcher.fetchTarball('github:foo/bar', 'main'),
    ).rejects.toThrow(/\(E181\).*did not return a 40-char SHA/);
  });

  it('(9) sends User-Agent + Accept headers per GitHub etiquette on both calls', async () => {
    const sha = 'c'.repeat(40);
    const captured: Array<{ url: string; headers: Headers }> = [];
    const fetchSpy = vi.fn(async (input: string | URL, init?: RequestInit) => {
      captured.push({
        url: input.toString(),
        headers: new Headers(init?.headers as HeadersInit),
      });
      if (input.toString().includes('/commits/')) {
        return jsonResponse({ sha });
      }
      return okResponse({ body: Buffer.from('x') });
    });
    const fetcher = new GitHubAgentPackFetcher({
      fetchImpl: fetchSpy,
      userAgent: 'minih/0.1.5',
    });
    await fetcher.fetchTarball('github:foo/bar', 'main');
    expect(captured.length).toBe(2);
    for (const c of captured) {
      expect(c.headers.get('user-agent')).toBe('minih/0.1.5');
      expect(c.headers.get('accept')).toBe('application/vnd.github+json');
    }
  });

  it('(10) ref "feature/foo" → URL-encoded to "feature%2Ffoo" in commits API call', async () => {
    const sha = 'd'.repeat(40);
    let commitsUrl: string | undefined;
    const fetchSpy = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url.includes('/commits/')) {
        commitsUrl = url;
        return jsonResponse({ sha });
      }
      return okResponse({ body: Buffer.from('x') });
    });
    const fetcher = new GitHubAgentPackFetcher({ fetchImpl: fetchSpy });
    await fetcher.fetchTarball('github:foo/bar', 'feature/foo');
    expect(commitsUrl).toContain('feature%2Ffoo');
  });

  it('(11) ref with "+" → URL-encoded to "%2B" in commits API call', async () => {
    const sha = 'e'.repeat(40);
    let commitsUrl: string | undefined;
    const fetchSpy = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url.includes('/commits/')) {
        commitsUrl = url;
        return jsonResponse({ sha });
      }
      return okResponse({ body: Buffer.from('x') });
    });
    const fetcher = new GitHubAgentPackFetcher({ fetchImpl: fetchSpy });
    await fetcher.fetchTarball('github:foo/bar', 'v1.0+rc1');
    expect(commitsUrl).toContain('v1.0%2Brc1');
  });

  it('(12) TLS handshake error on commits API → E181 with cause message', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new TypeError('certificate has expired');
    });
    const fetcher = new GitHubAgentPackFetcher({ fetchImpl: fetchSpy });
    await expect(
      fetcher.fetchTarball('github:foo/bar', 'main'),
    ).rejects.toThrow(/\(E181\).*certificate has expired/);
  });

  it('(13) DNS failure (ENOTFOUND) → E181', async () => {
    const fetchSpy = vi.fn(async () => {
      const err = new TypeError('fetch failed');
      // @ts-expect-error — Node 20 exposes `cause` on fetch errors.
      err.cause = { code: 'ENOTFOUND', hostname: 'api.github.com' };
      throw err;
    });
    const fetcher = new GitHubAgentPackFetcher({ fetchImpl: fetchSpy });
    await expect(
      fetcher.fetchTarball('github:foo/bar', 'main'),
    ).rejects.toThrow(/\(E181\).*network error|fetch failed/);
  });

  it('(14) request timeout (AbortController fires) → E181 timed out', async () => {
    const fetchSpy = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );
    const fetcher = new GitHubAgentPackFetcher({
      fetchImpl: fetchSpy,
      timeoutMs: 5,
    });
    await expect(
      fetcher.fetchTarball('github:foo/bar', 'main'),
    ).rejects.toThrow(/\(E181\).*timed out/);
  });

  it('(15) early-EOF mid-body on tarball → E181 fetch failed', async () => {
    const sha = 'f'.repeat(40);
    const fetchSpy = vi.fn(async (input: string | URL) => {
      if (input.toString().includes('/commits/')) {
        return jsonResponse({ sha });
      }
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.error(new Error('response stream ended unexpectedly'));
        },
      });
      return new Response(stream, { status: 200 });
    });
    const fetcher = new GitHubAgentPackFetcher({ fetchImpl: fetchSpy });
    await expect(
      fetcher.fetchTarball('github:foo/bar', 'main'),
    ).rejects.toThrow(/stream ended unexpectedly|fetch failed/);
  });

  it('(16) accepts https://github.com/owner/repo URL form (auto-builds API URLs)', async () => {
    const sha = '0'.repeat(40);
    const seen: string[] = [];
    const fetchSpy = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      seen.push(url);
      if (url.includes('/commits/')) return jsonResponse({ sha });
      return okResponse({ body: Buffer.from('x') });
    });
    const fetcher = new GitHubAgentPackFetcher({ fetchImpl: fetchSpy });
    await fetcher.fetchTarball('https://github.com/foo/bar.git', 'main');
    expect(
      seen.some(
        (u) => u === 'https://api.github.com/repos/foo/bar/commits/main',
      ),
    ).toBe(true);
    expect(
      seen.some(
        (u) => u === `https://api.github.com/repos/foo/bar/tarball/${sha}`,
      ),
    ).toBe(true);
  });
});
