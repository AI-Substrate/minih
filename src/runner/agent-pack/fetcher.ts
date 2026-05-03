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

interface FakeRecord {
  callKey: string;
  url: string;
  ref: string;
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
 * Real implementation — STUB IN PHASE 1. The full implementation lands in
 * Phase 3.2 (`GET /repos/{owner}/{repo}/tarball/{ref}` via Node `fetch()`,
 * with 10 MB cap and commit-sha extraction from the redirect URL).
 *
 * Kept as a named class so Phase 2/4 composition code can reference it,
 * and so dependency injection wiring compiles end-to-end. Calling
 * `fetchTarball()` throws — the runtime path hits this only if Phase 3
 * never landed AND somebody wired the real fetcher up early.
 */
export class GitHubAgentPackFetcher implements IAgentPackFetcher {
  fetchTarball(_url: string, _ref: string): Promise<FetchTarballResult> {
    return Promise.reject(
      new Error(
        'GitHubAgentPackFetcher.fetchTarball is not implemented in Phase 1; see Phase 3.2 (real fetch + extract). Use FakeAgentPackFetcher in tests.',
      ),
    );
  }
}

function makeKey(url: string, ref: string): string {
  return `${url}\u0001${ref}`;
}
