/**
 * Fetcher seam for agent-pack — the load-bearing test injection point.
 *
 * `IAgentPackFetcher` is the contract between install orchestration and
 * the source of an agent's bytes. Two implementations:
 *
 *   - `GitHubAgentPackFetcher` — stubbed in Phase 1; real `fetch()`
 *     against GitHub's tarball endpoint lands in Phase 3.2.
 *   - `FakeAgentPackFetcher` — used by Phase 2 install tests and Phase 4
 *     CLI integration tests so CI never hits real GitHub.
 *
 * The interface is deliberately minimal — `fetchTarball(url, ref)` returns
 * `{commitSha, tarball: Buffer}`. Adding methods is a forward-compat risk
 * (Phase 4 CLI may want `getMetadata`, retries, etc.); resist growth here
 * unless a downstream phase concretely demands it.
 */

/** What every fetcher must produce. */
export interface FetchTarballResult {
  /**
   * The commit sha the tarball corresponds to. For GitHub: extracted from
   * the redirect URL or the `etag` header. Recorded in
   * `.minih-source.json#source.commitSha`.
   */
  commitSha: string;
  /** Raw tar.gz bytes. Capped at 10 MB by the extractor in Phase 3.3. */
  tarball: Buffer;
}

/**
 * The seam between install orchestration and the source of agent bytes.
 * Swap a `FakeAgentPackFetcher` in for tests; `GitHubAgentPackFetcher` in
 * production.
 */
export interface IAgentPackFetcher {
  fetchTarball(url: string, ref: string): Promise<FetchTarballResult>;
}

interface FakeResponse {
  kind: 'success';
  result: FetchTarballResult;
}
interface FakeFailure {
  kind: 'failure';
  error: Error;
}
type FakeEntry = FakeResponse | FakeFailure;

/**
 * In-memory test double for `IAgentPackFetcher`. Tests register
 * `(url, ref) → response` mappings via `setSuccess` / `setFailure`, then
 * inject the fake into install orchestration. Records call history for
 * assertions.
 */
export class FakeAgentPackFetcher implements IAgentPackFetcher {
  private readonly responses = new Map<string, FakeEntry>();
  public readonly callHistory: Array<{ url: string; ref: string }> = [];
  public callCount = 0;

  /** Register a successful response for `(url, ref)`. Last-write-wins. */
  setSuccess(url: string, ref: string, result: FetchTarballResult): void {
    this.responses.set(makeKey(url, ref), { kind: 'success', result });
  }

  /** Register a failure for `(url, ref)`. Last-write-wins. */
  setFailure(url: string, ref: string, error: Error): void {
    this.responses.set(makeKey(url, ref), { kind: 'failure', error });
  }

  fetchTarball(url: string, ref: string): Promise<FetchTarballResult> {
    this.callCount += 1;
    this.callHistory.push({ url, ref });
    const entry = this.responses.get(makeKey(url, ref));
    if (!entry) {
      return Promise.reject(
        new Error(
          `FakeAgentPackFetcher: no response registered for url="${url}" ref="${ref}" — call setSuccess()/setFailure() first`,
        ),
      );
    }
    if (entry.kind === 'failure') {
      return Promise.reject(entry.error);
    }
    return Promise.resolve(entry.result);
  }
}

/**
 * Real implementation — Phase 3.2.
 *
 * Calls `GET https://api.github.com/repos/{owner}/{repo}/tarball/{ref}`
 * via Node 20+'s built-in `fetch()`. Headers per GitHub etiquette:
 *   - `Accept: application/vnd.github+json`
 *   - `User-Agent: minih/<version>`
 *
 * Auto-follows the 302 redirect to `codeload.github.com`. Captures the
 * commit sha from the redirect URL (codeload paths embed the full SHA-40
 * after the ref segment).
 *
 * **Caps and budgets**:
 *   - Pre-stream: rejects on `Content-Length > 10 MB` (E182).
 *   - Mid-stream: aborts when cumulative bytes > 10 MB (E182).
 *   - Wall-clock: 30 s budget via `AbortController` (covers slow-loris,
 *     stalled body, DNS hang, TLS handshake hang). Surfaces as E181.
 *
 * **No retry** in v1: 5xx and network errors surface immediately as E181.
 * Phase 4 should not silently retry — let users decide policy.
 *
 * The `url` argument is the user-supplied input (e.g. `github:owner/repo`
 * or full HTTPS); the caller is expected to have parsed it into
 * owner/repo via `parseAgentUrl` before calling. We accept the same
 * shorthand syntax here for symmetry — if `url` starts with `github:`,
 * we reformat it to the GitHub REST API endpoint; otherwise we expect
 * `https://github.com/{owner}/{repo}` shape.
 */
const GITHUB_TARBALL_MAX_BYTES = 10 * 1024 * 1024;
const GITHUB_REQUEST_TIMEOUT_MS = 30_000;

export interface GitHubAgentPackFetcherOptions {
  /** User-Agent header (per GitHub etiquette). Default `minih/<version>`. */
  userAgent?: string;
  /** Override max body size (bytes). Default 10 MB. */
  maxBytes?: number;
  /** Override request wall-clock timeout (ms). Default 30 s. */
  timeoutMs?: number;
  /** Inject `fetch` for tests. Default `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
}

export class GitHubAgentPackFetcher implements IAgentPackFetcher {
  private readonly userAgent: string;
  private readonly maxBytes: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: GitHubAgentPackFetcherOptions = {}) {
    this.userAgent = opts.userAgent ?? 'minih';
    this.maxBytes = opts.maxBytes ?? GITHUB_TARBALL_MAX_BYTES;
    this.timeoutMs = opts.timeoutMs ?? GITHUB_REQUEST_TIMEOUT_MS;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  async fetchTarball(url: string, ref: string): Promise<FetchTarballResult> {
    const owner_repo = parseOwnerRepo(url);
    const commitSha = await this.resolveCommitSha(owner_repo, ref);
    const tarball = await this.downloadTarball(owner_repo, commitSha);
    return { commitSha, tarball };
  }

  /**
   * Step 1: resolve `ref` (branch/tag/sha-prefix/full-sha) to a full
   * 40-char SHA via `GET /repos/{owner}/{repo}/commits/{ref}`. The
   * commits API auto-resolves all ref forms to a canonical commit. We
   * use this rather than parsing the SHA from the tarball-redirect URL
   * because GitHub's redirect for ref-based fetches lands on
   * `codeload.github.com/.../legacy.tar.gz/refs/heads/{ref}` WITHOUT a
   * SHA in the path. (SHA-based tarball fetches DO include it, which is
   * why we route through this helper.)
   */
  private async resolveCommitSha(
    owner_repo: { owner: string; repo: string },
    ref: string,
  ): Promise<string> {
    const apiUrl = `https://api.github.com/repos/${owner_repo.owner}/${owner_repo.repo}/commits/${encodeURIComponent(ref)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(apiUrl, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': this.userAgent,
        },
      });
    } catch (err) {
      clearTimeout(timer);
      const e = err as Error & { name?: string };
      if (e.name === 'AbortError' || /aborted/i.test(e.message ?? '')) {
        throw new Error(
          `agent-pack fetch failed (E181): commit-ref resolution to ${apiUrl} timed out after ${this.timeoutMs} ms`,
        );
      }
      throw new Error(
        `agent-pack fetch failed (E181): network error resolving ref ${ref} via ${apiUrl}: ${e.message ?? String(err)}`,
      );
    }

    try {
      if (!response.ok) {
        throw new Error(
          `agent-pack fetch failed (E181): ref resolution ${apiUrl} returned ${response.status} ${response.statusText}`,
        );
      }
      const body = (await response.json()) as { sha?: unknown };
      if (typeof body.sha !== 'string' || !/^[0-9a-f]{40}$/i.test(body.sha)) {
        throw new Error(
          `agent-pack fetch failed (E181): commits API for ref "${ref}" did not return a 40-char SHA (got ${JSON.stringify(body.sha)})`,
        );
      }
      return body.sha.toLowerCase();
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Step 2: download the tarball at the resolved commit SHA. We pass the
   * SHA directly so GitHub's redirect URL reliably includes it in the
   * path (defense in depth — even if upstream behavior changes, the
   * commit identity is fixed by what we passed).
   */
  private async downloadTarball(
    owner_repo: { owner: string; repo: string },
    commitSha: string,
  ): Promise<Buffer> {
    const apiUrl = `https://api.github.com/repos/${owner_repo.owner}/${owner_repo.repo}/tarball/${commitSha}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(apiUrl, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': this.userAgent,
        },
      });
    } catch (err) {
      clearTimeout(timer);
      const e = err as Error & { name?: string };
      if (e.name === 'AbortError' || /aborted/i.test(e.message ?? '')) {
        throw new Error(
          `agent-pack fetch failed (E181): tarball request to ${apiUrl} timed out after ${this.timeoutMs} ms`,
        );
      }
      throw new Error(
        `agent-pack fetch failed (E181): network error fetching ${apiUrl}: ${e.message ?? String(err)}`,
      );
    }

    try {
      if (!response.ok) {
        throw new Error(
          `agent-pack fetch failed (E181): ${apiUrl} returned ${response.status} ${response.statusText}`,
        );
      }

      const contentLength = response.headers.get('content-length');
      if (contentLength !== null) {
        const declared = Number.parseInt(contentLength, 10);
        if (
          Number.isFinite(declared) &&
          declared > 0 &&
          declared > this.maxBytes
        ) {
          throw new Error(
            `agent-pack tarball too large (E182): Content-Length ${declared} bytes exceeds limit ${this.maxBytes} bytes`,
          );
        }
      }

      const body = response.body;
      if (body === null) {
        throw new Error(
          `agent-pack fetch failed (E181): response body for ${apiUrl} was null`,
        );
      }
      const reader = body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > this.maxBytes) {
            try {
              await reader.cancel();
            } catch {
              /* ignore */
            }
            throw new Error(
              `agent-pack tarball too large (E182): streamed ${total} bytes exceeded limit ${this.maxBytes} bytes`,
            );
          }
          chunks.push(value);
        }
      }
      return Buffer.concat(chunks);
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Parse `(owner, repo)` from one of the accepted URL shapes:
 *   - `github:owner/repo`
 *   - `https://github.com/owner/repo[.git]`
 */
function parseOwnerRepo(url: string): { owner: string; repo: string } {
  let owner: string;
  let repo: string;
  if (url.startsWith('github:')) {
    const slug = url.slice('github:'.length).replace(/\.git$/, '');
    const parts = slug.split('/');
    if (parts.length < 2 || !parts[0] || !parts[1]) {
      throw new Error(
        `agent-pack fetch failed (E181): malformed github URL "${url}"`,
      );
    }
    [owner, repo] = parts;
  } else if (url.startsWith('https://github.com/')) {
    const slug = url
      .slice('https://github.com/'.length)
      .replace(/\.git$/, '')
      .replace(/\/$/, '');
    const parts = slug.split('/');
    if (parts.length < 2 || !parts[0] || !parts[1]) {
      throw new Error(
        `agent-pack fetch failed (E181): malformed github URL "${url}"`,
      );
    }
    [owner, repo] = parts;
  } else {
    throw new Error(
      `agent-pack fetch failed (E181): unsupported URL form "${url}" — only github: and https://github.com/ are accepted`,
    );
  }
  return { owner, repo };
}

function makeKey(url: string, ref: string): string {
  return `${url}\u0001${ref}`;
}
