# Phase 1: Foundations — Execution Log

**Plan**: [`../../agent-pack-install-plan.md`](../../agent-pack-install-plan.md)
**Phase**: Phase 1: Foundations
**Started**: 2026-05-03T12:33:00+10:00
**Mode**: Full
**Testing**: Hybrid (Full TDD for T002-T006, simple for T001/T007/T008)
**Harness**: N/A (no `docs/project-rules/harness.md`; spec § Clarifications Q6)

---

## Pre-Phase Validation

| Check | Status | Notes |
|---|---|---|
| Boot | N/A | No harness |
| Interact | N/A | No harness |
| Observe | N/A | No harness |
| `git status` clean | TBD | Verify before starting |
| Branch | `007-backgrounding` | Note: working in feature branch (carried over from prior plans) |

---

## Task Log

### T001 — types.ts (CREATE) — DONE 2026-05-03

- Wrote `src/runner/agent-pack/types.ts` with all 7 public types (`AgentPackManifest`, `AgentPackManifestFile`, `AgentPackSource`, `MinihSourceSidecar`, `RegistryEntry`, `RegistryCatalog`, `InstallAction`, `ParsedAgentUrl`).
- `npx tsc --noEmit src/runner/agent-pack/types.ts` clean.

### T002 — manifest.ts (TDD) — DONE 2026-05-03

- 20 tests covering happy path, missing prompt.md, traversal `..`, leading `/`, null byte, runtime-dir `runs/`/`inbox/`/`state/`/`.git/`, **backslash (Windows-style)**, duplicates, non-string desc, missing top-level fields, non-object input.
- Implementation exports `validateManifest`, `readAgentManifest`, `synthesizeImplicitManifest`, `checkManifestPath`, `RUNTIME_DIR_NAMES`, `CANONICAL_AGENT_FILES`, `AGENT_MANIFEST_FILENAME`.
- `RUNTIME_DIR_NAMES` exported as `readonly string[]` for Phase 3 extractor reuse (Finding 03 mitigation).
- All 20 tests green in 13ms.
- **Discovery**: backslash check (Comp-M1 from validation record) was easy to add inline — no separate task needed.

### T003 — registry.ts (TDD) — DONE 2026-05-03

- 11 tests covering valid catalog, missing file (returns empty catalog), unknown version (loud throw), malformed JSON, missing entry fields, **forward-compat unknown fields tolerated**, slug hit, slug miss with near-match (Levenshtein ≤2), slug miss without near-match, suggestions cap at 3, list sorted by slug.
- Implementation: `readRegistryCatalog`, `resolveRegistrySlug`, `listRegistryAgents` exported. Catalog read via `fileURLToPath(new URL('../../templates/agents-registry.json', import.meta.url))` (matches `init.ts:160` pattern).
- **Decision**: kept Levenshtein inline (~20 lines) instead of extracting from `validator.ts:17` — too small to share + avoids cross-file coupling.
- All 11 tests green in 11ms.

### T004 — source.ts (TDD) — DONE 2026-05-03

- 14 tests covering sidecar round-trip, missing-sidecar (returns null), non-existent dir on write (throws), malformed JSON, missing required field, **unknown schemaVersion (rejected loudly)**, **unknown fields tolerated on read (forward-compat)**, deterministic checksums, different content → different hash, missing file in checksum compute (throws), `verifyChecksums` returns 'unchanged'/'modified'/'missing', sha256-hex format with `sha256:` prefix.
- Implementation: `readSourceSidecar`, `writeSourceSidecar` (atomic via tmp+rename), `computeFileChecksums`, `verifyChecksums`, `SOURCE_SIDECAR_FILENAME` exported.
- **Discovery (Comp-L1)**: concurrent-write/disk-full/file-locked cases noted as deferred follow-ups; not yet covered by tests but `writeSourceSidecar` uses atomic tmp+rename which gives the right primitives for future hardening.
- All 14 tests green in 8ms.

### T005 — url.ts (TDD) — DONE 2026-05-03

- 21 tests covering all 3 syntax forms — npm-style `github:owner/repo[#ref][:subpath]`, full HTTPS (with `#ref:subpath` fragment AND `?path=` query), local path; `--subpath` override flag; canonical re-render round-trip; rejects: bare slug, empty input, traversal in subpath, **URL-encoded `..` (`%2e%2e/escape`)**, null byte, **>2048-byte input**.
- Implementation: `parseAgentUrl(input, opts?: {subpathOverride?})` + `renderAgentUrlCanonical` exported. Canonical form is npm-style `github:owner/repo#ref:subpath`; HTTPS inputs project to canonical npm-style on re-render. Trailing `.git` stripped from repo names.
- **Decision (Comp-M3)**: encoded traversal addressed via `safeDecodeURIComponent` then `checkManifestPath` — both layers reject. Oversized URL guarded via `Buffer.byteLength`.
- All 21 tests green in 3ms.

### T006 — fetcher.ts (TDD) — DONE 2026-05-03

- 8 tests covering Fake's `setSuccess`/`setFailure`/preset retrieval/missing-key rejection/`callHistory`/`callCount`/last-write-wins; real `GitHubAgentPackFetcher` stub class exists and throws "not implemented in Phase 1; see Phase 3.2".
- Implementation: `IAgentPackFetcher` minimal interface (one method: `fetchTarball(url, ref): Promise<{commitSha, tarball: Buffer}>`); `FakeAgentPackFetcher` class with last-write-wins preset map; `GitHubAgentPackFetcher` stub. `FetchTarballResult` exported as type.
- All 8 tests green in 3ms.

### T007 — re-exports — DONE 2026-05-03

- Wrote `src/runner/agent-pack/index.ts` barrel. Re-exports all public types + functions; aliases `ValidationResult` → `AgentManifestValidationResult` to avoid collision with view-types.
- Extended `src/runner/index.ts` with the agent-pack public surface (alphabetised by Biome).
- **Discovery**: existing runner exports already contain `ValidationResult` (from view-types). Renamed agent-pack's `ValidationResult` to `AgentManifestValidationResult` to disambiguate.

### T008 — error codes E180-E184 — DONE 2026-05-03

- Added 5 codes to `src/cli/output.ts#ErrorCodes`: `AGENT_PACK_REGISTRY_MISS = 'E180'`, `AGENT_PACK_FETCH_FAILED = 'E181'`, `AGENT_PACK_INVALID = 'E182'`, `AGENT_PACK_ALREADY_INSTALLED = 'E183'`, `AGENT_PACK_SOURCE_MISMATCH = 'E184'`.
- Updated docblock to list each new code.

---

## Final verification

- `npx vitest run test/runner/agent-pack/` → **74 tests passed** (manifest 20, registry 11, source 14, url 21, fetcher 8).
- `npx tsc --noEmit` → clean.
- `just fft` → **GREEN** (793 passed | 10 skipped | 0 vulnerabilities | SDK 0.3.0 latest).
- Domain manifest direction holds: no imports from `cli`, `mcp`, or `adapter` into `runner/agent-pack/`.
- `IAgentPackFetcher` is a single-method minimal contract — Phase 2 will compile against this directly.

## Discoveries & Learnings (to fold back to dossier)

| Date | Task | Type | Discovery | Resolution |
|---|---|---|---|---|
| 2026-05-03 | T002 | insight | Comp-M1 (uppercase/backslash/Unicode tricks) was a one-line addition (`\\` rejection in `checkManifestPath`); easy win | Added inline |
| 2026-05-03 | T003 | decision | Levenshtein extraction from `validator.ts` was overkill — kept inline (~20 lines) | Inline copy |
| 2026-05-03 | T005 | insight | Comp-M3 (URL-encoded traversal, oversized URL) addressed via `safeDecodeURIComponent` + `Buffer.byteLength` size cap | Addressed in spec'd test list |
| 2026-05-03 | T007 | gotcha | `ValidationResult` collision with view-types | Aliased to `AgentManifestValidationResult` on the runner barrel |
| 2026-05-03 | T002+T005 | decision | Several MEDIUM findings from earlier validate-v2 (Comp-M1, Comp-M3) folded into Phase 1 implementation rather than deferred to plan-6 — turns out they were trivial inline additions | Tests for backslash + encoded traversal + oversized URL all included in Phase 1 |
| 2026-05-03 | T004 | debt | Concurrent-write/lock/disk-full edge cases (Comp-L1) deferred — atomic tmp+rename gives the primitive for future hardening, but no tests yet | Documented in execution log |
