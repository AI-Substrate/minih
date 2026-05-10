# Execution Log: Fix FX001 — Local-path install

**Started**: 2026-05-03

## Pre-Fix State

- Plan-017 Phase 1 just shipped (`3bcb001`) — runner/agent-pack/ has 7 files (types, manifest, registry, source, url, fetcher, index) + 74 tests.
- No install orchestration yet; no CLI subcommand yet.
- `AgentPackSource` typed as `{ type: 'registry' | 'url'; ... }` — needs `'local'` variant for FX001.

## Task Log

(Per-task entries appended as work progresses.)

### FX001-1 — Widen `AgentPackSource` to discriminated union — DONE 2026-05-03

Updated `src/runner/agent-pack/types.ts` so `AgentPackSource` is now a discriminated union by `type`:
- `'registry'`: `{registrySlug, url, ref, subpath?, commitSha}`
- `'url'`: `{url, ref, subpath?, commitSha}`
- `'local'`: `{localPath, resolvedAt}` — no `ref`/`commitSha` (drift detected via per-file checksums)

Forward-compatible widening. Existing 14 source.test.ts tests still green.

### FX001-2 — Install orchestrator + 15 TDD tests — DONE 2026-05-03

NEW `src/runner/agent-pack/install.ts` (~250 LOC):
- `InstallSource` (caller-facing, no `commitSha`/`resolvedAt` — orchestrator computes them)
- `installAgentPack(opts: InstallOptions): Promise<InstallResult>`
- `RUNTIME_PRESERVE = Set('runs', 'inbox', 'state')` — single source of truth for the preservation guarantee
- Handles: read manifest OR synthesize implicit; validate (rejects pre-write); compute checksums; detect action (installed/upgraded/unchanged); atomic per-file rename (`.minih-tmp-<pid>`); surgical sync (delete OLD-manifest files not in NEW); preserve runtime dirs; write provenance sidecar last (after all source files in place)

Tests cover: fresh install with explicit agent.json + implicit manifest, no-op detection, upgrade with content change, runtime-dir preservation across upgrade, self-install refusal, E183 collision (folder exists w/o sidecar), `--as` aliasing, `--force` override, path-traversal rejection pre-write, missing source dir, missing prompt.md, sidecar shape verification (type='local' + resolvedAt + sha256 checksums). 15 tests, 25ms.

URL/registry source variants throw with helpful "not yet available; see Phase 3/4" messages embedding `(E182)` literal so the CLI error mapper picks E182 cleanly.

### FX001-3 — Re-exports — DONE 2026-05-03

`src/runner/agent-pack/index.ts` barrel + `src/runner/index.ts` extended to expose `installAgentPack`, `InstallOptions`, `InstallResult`, `InstallSource` to CLI consumers.

### FX001-4 — CLI subcommand — DONE 2026-05-03

NEW `src/cli/commands/agent.ts`:
- `agent install <ref>` subcommand under top-level `agent` group
- `parseRefToInstallSource(ref)` — local for `/`, `./`, `../`, Windows drive paths; URL for `http`/`https`/`github:`/`gitlab:`/`git@`; otherwise registry slug
- `pickErrorCode(message)` — strict precedence by `\bE18N\b` literal; URL/registry stubs map to E182
- JSON envelope on stdout with `action: 'installed' | 'upgraded' | 'unchanged'`; human table on stderr (✓ / ↻ / =)
- Honors `--agents-dir` global flag, `--as <slug>`, `--force`, `--yes`

### FX001-5 — Wiring + integration tests — DONE 2026-05-03

`src/cli/index.ts` extended with `registerAgentCommand(program)`. NEW `test/cli/agent-install-local.test.ts` (6 tests via `execFileSync` against built CLI):
- AC: fresh install → action='installed' + sidecar written
- AC: re-install → action='unchanged'
- AC: re-install after edit → action='upgraded' + changedFiles populated
- AC: URL ref → E182 "not yet available; Phase 3"
- AC: bare slug → E182 "not yet available; Phase 4"
- AC: `--as <slug>` aliases install path

**Discovery**: initial `pickErrorCode` regex matched `/registry/i` and `/fetch/i` too eagerly — the URL/registry stub messages contain those words. Fixed by making the precedence strict `\bE18N\b`-literal-first, with messages embedding `(E182)` inline.

---

## Final verification

- `npx vitest run test/runner/agent-pack/ test/cli/agent-install-local.test.ts` → **89 / 89 tests passed** (74 from Phase 1 + 15 install + 6 CLI integration)
- `npx tsc --noEmit` → clean
- `just fft` → **GREEN** (814 passed | 10 skipped | 0 vulns | SDK 0.3.0 latest)
- **Live verified**: in `/tmp/minih-fx001-demo`, `minih agent install /path/to/local/agent` produced `action: 'installed'`; re-running produced `'unchanged'`; editing source + re-running produced `'upgraded'` with `changedFiles: ['prompt.md']` and runtime dirs preserved.

## Discoveries & Learnings

| Date | Task | Type | Discovery | Resolution |
|---|---|---|---|---|
| 2026-05-03 | FX001-2 | decision | `AgentPackSource` widened to discriminated union (was originally a single shape with optional `registrySlug?`). Cleaner — local has no `ref`/`commitSha`. | Updated `types.ts` and all consumers. |
| 2026-05-03 | FX001-2 | insight | "Surgical sync" on upgrade (deleting files in OLD manifest but not in NEW) is implemented and tested by upgrade-with-runtime-preservation case. The same code path will work for git/registry sources in Phase 2/3. | Generic — not local-only. |
| 2026-05-03 | FX001-4 | gotcha | `pickErrorCode` regex order matters — `/fetch/i` matched the URL stub message "remote-fetch implementation lands in Phase 3.2", returning E181 incorrectly. | Switched to strict `\bE182\b` literal precedence; embedded the code in the message. |
| 2026-05-03 | FX001-2 | debt | Concurrent-install / concurrent-upgrade races not covered. Two `minih agent install` calls running simultaneously in the same target dir would race on `tmp+rename`. Acceptable for v1 but worth noting. | Documented; not blocking. |
| 2026-05-03 | overall | insight | Vertical slice approach worked — exercising the full install state machine end-to-end (install → unchanged → upgraded) without needing Phase 3/4 surfaced no surprises. The atomic-swap algorithm is correct for the local-path case; Phase 2 will reuse it for FakeFetcher with zero changes. | Validates the architecture. |
