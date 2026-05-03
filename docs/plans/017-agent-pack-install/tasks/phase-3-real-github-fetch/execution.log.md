# Phase 3: Real GitHub fetch — Execution Log

**Plan**: [`../../agent-pack-install-plan.md`](../../agent-pack-install-plan.md)
**Phase**: Phase 3: Real fetch — GitHub tarball download + extract
**Started**: 2026-05-03T13:50:00+10:00
**Mode**: Full
**Testing**: Hybrid (Full TDD for T003/T004/T005/T006; integration tests for T008; gated e2e for T009)
**Harness**: N/A (no `docs/project-rules/harness.md`; spec § Clarifications Q6)

---

## Pre-Phase Validation

| Check | Status | Notes |
|---|---|---|
| Boot | N/A | No harness |
| Interact | N/A | No harness |
| Observe | N/A | No harness |
| `git status` clean | ✅ | Only the new phase-3 directory pending |
| Branch | `007-backgrounding` | Carrying through from prior plans/fixes |
| Baseline | 827 passed / 10 skipped (commit `549aa97`) | FX002 shipped |

---

## Task Log

(Per-task entries appended as work progresses.)

### T001 — R2 deepresearch (tar dep choice) — DONE 2026-05-03

Ran Perplexity sonar-reasoning-pro then verified empirically with `npm install` in fresh `type:"module"` projects.

**Empirical findings**:
- `tar-stream@3.2.0` → 13 packages installed (Bare-runtime ecosystem: `b4a`, `bare-fs`, `bare-stream`, `bare-path`, `bare-os`, `bare-url`, `bare-events`, `teex`, `streamx`, `fast-fifo`)
- `tar@7.5.13` (node-tar) → 6 packages installed (all isaacs: `@isaacs/fs-minipass`, `chownr`, `minipass`, `minizlib`, `yallist`)
- Both audit clean (0 high/critical)

**Discovery**: Perplexity's preliminary reasoning assumed `tar-stream` pulls `gunzip-maybe` — actually false. But `tar-stream`'s real dep chain is the **Bare runtime ecosystem**, which is bigger than `tar`'s isaacs stack.

**DECISION**: `tar` (node-tar) v^7.5.13 — low-level `Parser` API. We pipe `node:zlib.createGunzip()` → `new tar.Parser()` → entry events → custom validation gates → write to disk. Library does format parsing; we own policy.

Wrote `docs/plans/017-agent-pack-install/external-research/tarball-extract.md` with full comparison + rationale + accepted risks.

### T002 — Add tar dep + audit — DONE 2026-05-03

`npm install --save tar@^7.5.13` completed cleanly (resolved to `7.5.13`). `package.json` now includes `"tar": "^7.5.13"`; `package-lock.json` updated. Tree clean: 6 transitive packages (all isaacs).

Baseline verification:
- `npm test` → **827 passed | 10 skipped** (matches pre-install baseline — no regressions)
- `npm audit --omit=dev` → **0 vulnerabilities**

No `@types/tar` needed (types bundled via `./dist/esm/index.d.ts`).

Domain Manifest unchanged — `tar` is a runtime dep but only consumed by `runner/agent-pack/extractor.ts` (T003+), no other domain touches it.

### T003 — extractor.ts happy path (TDD) — DONE 2026-05-03

NEW `src/runner/agent-pack/extractor.ts` (~280 LOC) and `test/runner/agent-pack/extractor.test.ts` (~180 LOC).

**Architecture**: gzipped Buffer → `node:zlib.createGunzip()` → `tar.Parser` (low-level, named import from `tar`) → per-entry handler → `fs.createWriteStream` (with `wx` flag for defense-in-depth). Resolves to `{filesWritten: string[]}`.

**Test-fixture helper**: `makeTarFixture(entries, opts)` stages entries to a tmp dir, packs them via `tar.Pack`, gzips with `zlib.gzipSync`. Returns a Buffer. Cleanup is automatic via try/finally.

**5 happy-path tests, all green** (17ms):
1. 3-file tarball with prefix-stripping ✓
2. GitHub-style top-level prefix `AI-Substrate-minih-deadbeef/` stripped entirely ✓
3. Empty tarball returns `filesWritten: []` ✓
4. Nested directory entries — parent dirs created automatically ✓
5. Binary content byte-exactly preserved ✓

**Discovery (gotcha)**: `parser.on('end')` fires when the tar bytes are fully parsed, but file write streams may still be flushing. Initial impl resolved the promise too early → 4/5 tests failed with empty `filesWritten`. Fixed by tracking `pendingWrites` counter; `maybeFinish()` only resolves when both `parserEnded === true` AND `pendingWrites === 0`.

**Pax/GlobalHeader/long-name/long-linkpath/OldGnuLongPath entries**: skipped silently (with `entry.resume()`); `tar.Parser` already applies their effects to subsequent entries. They DO count toward `maxEntries` (defensive — prevents 10 K pax-padding flood).

**`exclusive write` flag**: `fs.createWriteStream(..., {flags: 'wx'})` fails if the destination exists. Combined with the `seenPaths` Set, this gives us defense-in-depth against duplicate-path attacks.

### T004 — extractor.ts security guards (TDD 38+) — DONE 2026-05-03

Hardened `extractor.ts` with the full guard suite + wrote 39 test cases. **44/44 total tests green** (5 happy-path + 39 security).

**Security guards added** (in `handleEntry` order):
1. Hard-link rejection (`Link` typeflag)
2. Symlink rejection (`SymbolicLink`)
3. Device/FIFO/sparse/contiguous rejection (`CharacterDevice`/`BlockDevice`/`FIFO`/`SparseFile`/`ContiguousFile`)
4. File-mode safety: `mode & 0o7777` masked, must be ≤ `0o755` (rejects setuid/setgid/sticky)
5. Path-shape gate (`checkPathShape`) — applied BEFORE prefix-strip AND on stripped tail:
   - empty path
   - byte-length > maxPathLength
   - null byte
   - backslash anywhere
   - leading `/`
   - leading drive letter `[A-Z]:` regex
   - NFKC-normalized `..` segment check (catches fullwidth `．．`)
   - `.` segment rejected (suspicious)
6. Runtime-dir denylist after strip — first path component must NOT be `runs`/`inbox`/`state`/`.git` (consumes `RUNTIME_DIR_NAMES` from `manifest.ts` — single source of truth)
7. Top-level prefix consistency mid-stream (reject second-and-later entries that don't share the first entry's leading dir)
8. Duplicate-path detection via `seenPaths` Set
9. Per-entry size cap (2 MB) at write-time
10. Cumulative size cap (10 MB) at write-time
11. Expansion-ratio cap (100x) at write-time
12. Wall-clock budget (5 s soft) via `setTimeout` + `parser.abort()`
13. Pax/GlobalHeader/long-name/long-linkpath IGNORED silently (count toward `maxEntries` for defense)

**Discovery (gotcha 1)**: `gunzip.pipe(parser)` failed because `tar.Parser` extends `EventEmitter` not `Readable`/`Writable` properly. `pipe()` calls `.destroy(err)` on errors, which `Parser` doesn't have. Fixed by manually pumping: `gunzip.on('data') → parser.write(chunk)`, `gunzip.on('end') → parser.end()`. `tar.Parser` exposes `.abort(error)` instead of `.destroy()`.

**Discovery (gotcha 2)**: `tar.Header` strips null bytes from path before encoding (truncates at first null). Means our null-byte path-shape check is dead code via this attack vector — defense-in-depth at the lib layer. Test (g) updated to verify the lib's defense is sufficient (no malicious file escapes), and our `checkPathShape` null-byte guard remains a belt-and-braces safeguard for any future bypass.

**Discovery (gotcha 3)**: Same lib-layer defense for path > 255 bytes — ustar caps at 155 (prefix) + 100 (name) without pax extension. Test (c) similarly relaxed to verify the truncated path is safe (under cap, no traversal escape).

**Discovery (gotcha 4)**: PRNG-based "incompressible" filler from a linear congruential generator still compresses ~30% (gzip detects subtle patterns). Switched to `crypto.randomBytes()` for true entropy. Lock-step ratio now sits well below the 100x cap.

**MaxListenersExceededWarning** noted: 11 drain listeners on the gunzip stream during the 200-entry happy path. Cosmetic — not a leak (each entry's writeStream cleans up on close). Suppressed via `parser.setMaxListeners(0)` not added in this pass; flagged for follow-up if it becomes test noise.

### T005 — GitHubAgentPackFetcher real impl (TDD) — DONE 2026-05-03

Replaced the Phase 1 stub body in `src/runner/agent-pack/fetcher.ts` with a real `fetch()`-based implementation. **22/22 tests green** (6 Fake + 16 real impl).

**Architecture**:
- Constructor accepts `{userAgent, maxBytes, timeoutMs, fetchImpl}` — `fetchImpl` enables test injection (default `globalThis.fetch`)
- `buildGithubTarballApiUrl(url, ref)` accepts `github:owner/repo` OR `https://github.com/owner/repo[.git]`; URL-encodes the ref via `encodeURIComponent`
- `AbortController` with 30 s default timeout
- Headers: `Accept: application/vnd.github+json` + `User-Agent: minih`
- Pre-stream cap: `Content-Length > maxBytes` → E182 BEFORE body read
- Mid-stream cap: `body.getReader()` loop; abort + cancel reader when `total > maxBytes`
- Commit-sha extraction: scans `response.url` for the LAST 40-char hex run (handles `refs/heads/{ref}/{sha}`, `refs/tags/{ref}/{sha}`, and direct `{sha}` patterns)
- No retry — 5xx and network errors surface immediately as E181

**16 mocked-fetch tests cover**: happy path, 404, 403 rate-limit, 500 (no retry verified via `toHaveBeenCalledTimes(1)`), TypeError network, Content-Length 11 MB, mid-stream overflow, missing-sha redirect, headers verified, ref URL-encoding (`/` and `+`), TLS error, DNS ENOTFOUND, AbortController timeout, early-EOF stream error, https:// URL form auto-builds API URL.

**Discovery (gotcha)**: Initial regex assertions used `/(E182).*too large/` but the actual error message is `agent-pack tarball too large (E182): ...` — "(E182)" comes AFTER "too large", not before. Reordered to `/too large \(E182\).*streamed/`. The `pickErrorCode` regex in CLI is unaffected (it just looks for `\bE182\b` anywhere).

**Test isolation**: zero real network calls. `vi.fn()` swaps in `fetchImpl` per-test. ReadableStream test fixtures use `new Response(stream, ...)` with `Object.defineProperty(response, 'url', ...)` since the standard Response.url is read-only.

### T006 — Wire installFromUrl — DONE 2026-05-03

Refactored `install.ts` to extract a shared `installFromStagedDir()` helper that both `installFromLocal` and the new `installFromUrl` reuse. Added `fetcher?: IAgentPackFetcher` to `InstallOptions`. Removed the FX001 URL E182 stub.

**Architecture**:
- `installAgentPack` discriminates on `source.type`:
  - `local` → `installFromLocal` (validates path → builds sidecarSource → helper)
  - `url` → checks `opts.fetcher` is provided (otherwise composition-root bug, throws); fetches → `os.tmpdir()/minih-agent-pack-<rand>` mkdtempSync → `extractTarball` → optional subpath slice → builds sidecarSource → helper. Cleanup via try/finally.
  - `registry` → still throws E182 ("not yet available; Phase 4")
- `installFromStagedDir` is the unified post-source-resolution path: read manifest → compute checksums → detect prior sidecar → no-op detection (via new `sourcesEquivalent` helper) → atomic per-file copy → write sidecar
- New `extractRepoNameFromUrl` — derives slug from `github:foo/my-agent` → `my-agent` (subpath leaf takes precedence when present)
- New `sourcesEquivalent(a, b)` — compares sidecar sources type-by-type. URL: same `url+ref+subpath` (commitSha differs → upgrade). Local: same `localPath`. Registry: same `registrySlug`.

**11 URL install tests, all green**:
(a) URL install with prefilled fake → action=installed + sidecar.source.type=url + commitSha matches
(b) URL re-install same content → action=unchanged
(c) URL upgrade — fake tarball changes → action=upgraded + changedFiles populated + new content on disk
(d) URL with subpath → installs only the slice (`agents/demo/prompt.md` + slug=`demo`); other agents NOT installed
(e) URL with non-existent subpath → E182 (regex order fixed: `subpath.*not found.*\(E182\)`)
(g) tmp dir cleaned up on success — count of `minih-agent-pack-*` entries unchanged
(h) tmp dir cleaned up on extract failure — same
(i) fetcher rejection → E181 bubbles up
(j) URL source without fetcher opt → composition-root bug guard fires
(k) slug derivation without subpath → uses repo name (`github:foo/my-special-agent` → `my-special-agent`)

**Discovery**: refactor flowed cleanly because FX001's local-install code never depended on the path being "user-provided" — it only used `localPath` as a source dir + `path.basename(localPath)` for the default slug. Substituting a tmp-dir for `localPath` and a derived slug worked verbatim. **Validation: the FX001 architecture WAS path-agnostic.** All 15 FX001 tests still green.

**Discovery (test fixture)**: needed a parallel `makeGithubTarball` helper in `install.test.ts` (separate from the one in `extractor.test.ts`) because install tests need GitHub-style prefix wrapping. Considered consolidating into a shared test util but the helpers are short (~30 LOC each) and serve different narratives — kept duplicated for now.

**Re-exports**: added `extractTarball`, `ExtractOptions`, `ExtractTarballResult`, `GitHubAgentPackFetcherOptions` to `runner/agent-pack/index.ts` barrel and bubbled up through `runner/index.ts`.

### T007 — CLI composition root + production-safe injection seam — DONE 2026-05-03

Added `resolveFetcher(): IAgentPackFetcher` in `src/cli/commands/agent.ts`.

**Default**: `new GitHubAgentPackFetcher({userAgent: 'minih/<version>'})` (version read once via `getMinihVersion()` from `package.json` using the existing `fileURLToPath(import.meta.url)` pattern).

**Injection seam (`MINIH_AGENT_PACK_FETCHER=fake:<json>`)**:
- Hard-fail with E181 if env var set + `NODE_ENV !== 'test'` ("refusing to use a fake fetcher in production")
- Hard-fail with E181 if env var doesn't start with `fake:` ("malformed: expected fake:<json>")
- Hard-fail with E181 if JSON parse fails
- Hard-fail with E181 if any preset key is missing the `\u0001` separator
- ALWAYS prints stderr warning: `[minih] using FakeAgentPackFetcher (NODE_ENV=test, MINIH_AGENT_PACK_FETCHER set with N preset response(s))`

**3 production-safety tests** in `test/cli/agent-install-url.test.ts`:
- (safety-1): NODE_ENV=production + env set → E181 with "NODE_ENV is not "test""
- (safety-2): malformed JSON → E181 with "malformed | JSON"
- (safety-3): NODE_ENV=test + valid env → stderr contains warning line

**Discovery (gotcha 1)**: existing `agent-install-local.test.ts` had a `run()` helper using `execFileSync` which only captures stderr on the throw path. For `safety-3` test (success exit + stderr), I switched to `spawnSync` which captures both regardless of exit code. The new `agent-install-url.test.ts` uses spawnSync throughout.

**Discovery (gotcha 2)**: 4 existing FX001 tests asserted `expect(envelope.error.code).toBe('E182')` for URL inputs because the URL path used to throw a stub error. Phase 3 made the URL path real → those tests now hit E181 (real fetcher fails because no preset registered when `MINIH_AGENT_PACK_FETCHER='fake:{}'`). Updated all 4 tests to: (a) inject `MINIH_AGENT_PACK_FETCHER=fake:{}` deterministically, (b) accept either E181 or E182, (c) drop "not yet available" message asserts (the message is now real fetcher error). Tests rebranded to "Phase 3 — was E182 stub in FX001, now hits real fetcher."

### T008 — CLI URL-install integration tests — DONE 2026-05-03

11 tests in `test/cli/agent-install-url.test.ts`, all green:
- 3 T007 production-safety (above)
- 8 T008 URL install scenarios:
  (1) install `github:foo/my-agent#main` → action='installed' + sidecar.source.type='url' + commitSha
  (2) re-install same → action='unchanged'
  (3) re-install with new tarball → action='upgraded'
  (4) `--ref develop` overrides URL fragment `#main`
  (5) `--subpath agents/demo` slices the install
  (6) HTTPS URL form `https://github.com/foo/my-agent.git#main` works (canonicalizes to `github:foo/my-agent`)
  (7) fake fetcher registered failure → E181/E182
  (8) `--as <slug>` aliases the install path

**Discovery (gotcha 3)**: original parseRefToInstallSource was passing the FULL input string (including `#ref:subpath`) as the `url` field downstream. The fetcher then looked up `github:foo/bar#main` in the FakeAgentPackFetcher preset map, which keyed on `github:foo/bar`. Mismatch → "no response registered" failure. **Fixed** by canonicalizing: `cleanUrl = github:${parsed.owner}/${parsed.repo}` — fragment + query stripped; ref + subpath travel as separate fields. This also unifies HTTPS and shorthand URL forms (test (6) verifies).

**Total Phase 3 test additions**: 79 (44 extractor + 16 fetcher + 11 install-URL + 11 CLI URL-install — minus the 3 stub-test deletions in fetcher.test.ts and the 4 FX001 test rewrites = ~80 net new tests; suite went from 827 → 906).

### T009 — MINIH_E2E real-fetch test — DONE 2026-05-03

NEW `test/e2e/agent-pack-real-fetch.test.ts`. Gated by `runE2e ? describe : describe.skip` pattern (matches `two-agent-coordination.test.ts`).

**Two e2e tests**:
1. Installs `agents/code-review` from `AI-Substrate/minih@main` — verifies sidecar shape (schemaVersion='1', source.type='url', commitSha SHA-40, ref='main', subpath='agents/code-review')
2. Bogus repo URL → E181 envelope

**Discovery (fix 1)**: my initial fetcher impl extracted commit-sha from `response.url` after the redirect. **Real GitHub redirects to `https://codeload.github.com/{owner}/{repo}/legacy.tar.gz/refs/heads/{ref}` for ref-based fetches — NO SHA in the path.** SHA only appears in the path when fetching by sha directly. Fixed by switching to a 2-step API:
1. `GET /repos/{owner}/{repo}/commits/{ref}` → JSON `{sha: "<full-40>"}`
2. `GET /repos/{owner}/{repo}/tarball/{sha}` → tarball bytes
This is reliable across all ref forms (branches, tags, sha-prefixes) and the redirect URL DOES include the SHA in path when fetching by sha.

Updated `fetcher.test.ts` mock-fetch: routes URLs by pattern (`/commits/` → JSON sha; `/tarball/` → bytes). All 16 mocked tests still green.

**Discovery (fix 2)**: file mode 0o775 (group-writable) is common in real GitHub tarballs (especially for directory entries). My initial extractor rejected anything > 0o755, blocking the install. Loosened to reject ONLY setuid/setgid/sticky bits (the actual elevation risks): `(mode & 0o7000) !== 0`. We don't honor mode bits during extraction anyway (we use stream copy + OS umask).

**Discovery (fix 3)**: default `maxEntries` of 200 was too tight — minih repo has 191 entries (close), and any larger monorepo would hit it. **Bumped default to 5000.** Real attack-flood test still triggers at 5001+ entries. Test (b) updated to send 5001.

**Discovery (fix 4)**: `agents/code-review-companion` doesn't exist on `origin/main` yet (only on `007-backgrounding`). Switched the e2e target to `agents/code-review` which is stable on main and exercises the same pipeline.

**Discovery (fix 5)**: extractor `afterEach` cleanup race — `ENOTEMPTY` errors when an aborted extract leaves in-flight write streams flushing. Wrapped `fs.rmSync` in try-catch with a 50ms retry. Functional correctness intact (rejection still works); only cleanup is best-effort.

**Live verified end-to-end**: in fresh `/tmp/e2e-test`, `minih agent install github:AI-Substrate/minih#main:agents/code-review --yes` produced `action='installed'`, sidecar with full SHA `6f6c844073ed1ef4eb6ab316d4208b69e403bb4b`, all 4 files extracted (prompt, instructions, input-schema, output-schema). 

### T010 — domain.md updates + plan progress — DONE 2026-05-03

**`docs/domains/runner/domain.md`**:
- History: appended `017-agent-pack-install P3` row with full Phase 3 narrative (extractor + fetcher real impl + installFromUrl + tar dep + 79 new tests)
- Concepts: appended 3 new concept rows
  - **Agent pack install** — installAgentPack as the entry point, three source types, shared `installFromStagedDir` helper, runtime-dir preservation guarantee, sidecar-driven action discriminator
  - **Tarball extraction** — extractTarball pipeline (gunzip → tar.Parser → policy gates), prefix strip, named attack rejection, DoS guards, pax/longname IGNORE
  - **Fetcher injection seam** — IAgentPackFetcher contract, GitHub real impl with 2-step API, FakeAgentPackFetcher for tests, CLI composition root
- Composition table: P1 entries already cover types/manifest/registry/source/url/fetcher/index/install. Phase 3 doesn't add new files needing separate composition rows beyond what's already documented in History.

**`docs/domains/cli/domain.md`**:
- History: appended `017-agent-pack-install P3` row covering composition root + `MINIH_AGENT_PACK_FETCHER` env-var injection seam (NODE_ENV=test gated, warning line on use, hard-fail on misconfiguration) + URL canonicalization + 11 new test cases

**Plan progress**: marked all T001-T010 done in tasks.md table, Architecture Map all green, flight plan stages all `[x]`, Status `Landed`, Flight Status mermaid all `done`. (`/plan-6a-v2-update-progress` not invoked separately — direct file edits captured the same state.)

**Final stats**:
- 907 tests passed | 12 skipped | 0 vulnerabilities | SDK 0.3.0 latest
- 79 net new tests vs P1+FX001+FX002 baseline (was 827)
- `just fft` GREEN
- Live verified end-to-end: `minih agent install github:AI-Substrate/minih#main:agents/code-review --yes` from a fresh tmp project — installs successfully with sidecar.source.type='url', commitSha=full SHA-40, all manifest files extracted

