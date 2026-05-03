# Agent Pack Install — Implementation Plan

**Plan Version**: 1.0.0
**Created**: 2026-05-03
**Spec**: `docs/plans/017-agent-pack-install/agent-pack-install-spec.md`
**Mode**: Full
**Status**: DRAFT

## Summary

Add a CLI surface — `minih agent install|info|list|remove` — that fetches agent packs from a baked-in registry of GitHub URL pointers (or arbitrary git URLs), drops them into the local `agentsDir`, writes a provenance sidecar, and is idempotent (re-run = upgrade). The registry contains URLs only, not bundled agent files, so canonical agents iterate independently of CLI releases. v1 ships with one registered agent: `code-review-companion`. The install path is the first HTTP code in `src/`; we introduce an `IAgentPackFetcher` injection seam so all unit/integration tests stay deterministic.

## Target Domains

| Domain | Status | Relationship | Role |
|---|---|---|---|
| `cli` | existing | **modify** | New `agent <verb>` subcommand group; new error codes E180-E184; `minih list` aliasing |
| `runner` | existing | **modify** | New internal `agent-pack/` module: registry, source sidecar, fetcher, extractor, manifest validator, install/upgrade orchestration |
| `adapter` | existing | NOT involved | n/a |
| `mcp` | existing | NOT involved | n/a |

No new domains. `agent-pack/` is an internal sub-module of `runner`, exposed via `runner/index.ts` re-exports. Cross-domain direction (`cli → runner`) preserved.

## Domain Manifest

| File | Domain | Classification | Rationale |
|---|---|---|---|
| `src/runner/agent-pack/types.ts` | runner | contract | Shared types: `AgentPackManifest`, `AgentPackSource`, `RegistryEntry`, `InstallAction` |
| `src/runner/agent-pack/manifest.ts` | runner | internal | Read/parse `agent.json`; validate `files[]` (path traversal, runtime-dir denylist); implicit-manifest fallback |
| `src/runner/agent-pack/registry.ts` | runner | internal | Read `dist/templates/agents-registry.json`; resolve slug → entry; Levenshtein "did you mean" |
| `src/runner/agent-pack/source.ts` | runner | internal | Read/write `.minih-source.json` sidecar; checksum compute + verify |
| `src/runner/agent-pack/fetcher.ts` | runner | contract + internal | `IAgentPackFetcher` interface + real impl (Node `fetch()` against GitHub) + `FakeAgentPackFetcher` for tests |
| `src/runner/agent-pack/extractor.ts` | runner | internal | Tarball → temp dir; size cap (10 MB); path-traversal & symlink defense |
| `src/runner/agent-pack/install.ts` | runner | internal | Orchestrates fetch → extract → manifest validate → swap files → write sidecar; handles install/upgrade/no-op branching |
| `src/runner/agent-pack/remove.ts` | runner | internal | Uninstall with optional runtime-dir archival |
| `src/runner/agent-pack/url.ts` | runner | internal | Parse npm-style shorthand + HTTPS + flag forms; canonical re-render |
| `src/runner/agent-pack/index.ts` | runner | contract | Re-export public surface for `cli` to consume via `runner/index.ts` |
| `src/runner/index.ts` | runner | contract | Re-export `installAgentPack`, `removeAgentPack`, `infoAgentPack`, `listAvailableAgents`, types |
| `src/cli/commands/agent.ts` | cli | internal | `agent <verb>` subcommand group; flag parsing; JSON envelope emission; confirmation prompt |
| `src/cli/commands/list.ts` | cli | internal | EXTEND — accept `--available`, `--all` flags; existing behaviour preserved (alias for `agent list`) |
| `src/cli/output.ts` | cli | contract | EXTEND — add E180-E184 error codes |
| `src/cli/index.ts` | cli | internal | EXTEND — `registerAgentCommand(program)` |
| `src/templates/agents-registry.json` | runner | shipped asset | The baked-in registry catalog (one entry in v1) |
| `dist/templates/agents-registry.json` | build | shipped artifact | Built copy of registry catalog; `package.json#files = ["dist", ...]` ships it; consumed at install time via `import.meta.url` resolution |
| `agents/code-review-companion/agent.json` | (dogfood) | NEW | Manifest for the canonical companion; fetched at install time by other projects |
| `scripts/copy-schemas.js` | build | internal | EXTEND — copy `agents-registry.json` to `dist/templates/` |
| `test/runner/agent-pack/*.test.ts` | runner | test | Unit tests with `FakeAgentPackFetcher` |
| `test/cli/agent-install.test.ts` | cli | test | `execSync` integration tests against built CLI |
| `test/e2e/agent-pack-real-fetch.test.ts` | cli/runner | test | Gated `MINIH_E2E=1`; real GitHub fetch end-to-end |
| `docs/how/agent-pack.md` | docs | NEW | User guide |
| `README.md` | docs | extend | New "Agent Packs" section |
| `AGENTS.md` | docs | extend | Companion-mode section gains `agent install code-review-companion` reference |
| `AGENTS_README.md` | docs | extend | Mention `agent` subcommand alongside `init`/`run` |
| `docs/domains/cli/domain.md` | docs | extend | History row + composition entry |
| `docs/domains/runner/domain.md` | docs | extend | History row + composition entry + new contracts; concepts table updated |
| `docs/domains/domain-map.md` | docs | extend | Phase 6.7 — refresh node labels for `cli` (new `agent` subcommand) and `runner` (new `agent-pack/` exports); no new edges |

## Key Findings

| # | Impact | Finding | Action |
|---|---|---|---|
| 01 | Critical | First HTTP code in `src/` — testing strategy must avoid real GitHub in CI. | Introduce `IAgentPackFetcher` interface (mirrors `IAgentAdapter` pattern from `src/adapter/`); inject `FakeAgentPackFetcher` in tests; gate real fetch behind `MINIH_E2E=1`. Phase 1 task. |
| 02 | Critical | Atomic-swap on upgrade is non-trivial — partial failure could leave agent folder broken. | Phase 2 algorithm: download to temp dir → validate complete manifest → atomic rename source files → preserve runtime dirs. Workshop W2 is reference. Each file replacement uses `fs.renameSync` for atomicity within the same filesystem. |
| 03 | High | Manifest path-traversal & runtime-dir tampering risk (malicious `agent.json` could claim to "ship" `runs/...` paths). | Phase 1 manifest validator rejects: `..` in any path component, leading `/`, paths starting with `runs/`/`inbox/`/`state/`/`.git/`, null bytes. Validated BEFORE any file is written. E182. |
| 04 | High | Self-install in minih repo would clobber unstaged work in canonical `agents/<slug>/` source. | Phase 4 detection: if cwd is inside the minih source repo AND `agents/<slug>/` is the registered canonical source path, refuse with instructive error referencing `--as <new-slug>`. Heuristic: walk up from cwd looking for `package.json` with `name: "minih"`. |
| 05 | High | `.minih-source.json` is load-bearing for upgrade UX — schema evolution matters. | Schema include `schemaVersion: "1"` field from day 1; tolerate unknown fields on read for forward-compat. Phase 1 task: write schema + `loadSourceSidecar`/`writeSourceSidecar` with validation. |
| 06 | High | Registry is curation gate — auto-discovery from repo's `agents/` dir would defeat the purpose. | Phase 3 install algorithm only reads `agents-registry.json`; never scans the source repo's `agents/` directory. Tests verify a slug for an internal-only agent (e.g. `smoke-test`) returns E180 even though the file exists in the dogfood `agents/` dir. |
| 07 | High | Tar parser dependency choice has security and weight tradeoffs. | Phase 3 task: evaluate `tar-stream` (popular, ~5 KB, streaming) vs hand-rolled minimal reader vs `node-tar` (heavier). Decision after R2 deepresearch. Default expectation: `tar-stream` (matches Node ecosystem norms). |
| 08 | High | `--agents-dir` global flag must be honored as install destination. | Phase 4 CLI command reads `program.opts().agentsDir` (existing pattern in `init.ts:226`). Acceptance criteria include test with custom `--agents-dir`. |
| 09 | Medium | Tarballs from GitHub include a `<repo>-<sha>/` top-level directory prefix. | Phase 3 extractor strips the prefix when extracting; documented in code comment + test fixture covers it. |
| 10 | Medium | The `code-review-companion` and other canonical agents currently lack `agent.json` — needed for fetched installs to include extras like `outside.md`. | Phase 5 task: author `agent.json` for `code-review-companion` listing all 6 files (prompt, instructions, outside, output-schema, inside-state-schema, outside-state-schema). |

## Phase Index

| Phase | Title | Primary Domain | Objective | Depends On |
|---|---|---|---|---|
| 1 | Foundations — types, manifest, registry, source sidecar, fetcher seam | runner | Define types and read-only logic; introduce `IAgentPackFetcher`; no network code yet | None |
| 2 | Local install path with FakeAgentPackFetcher | runner | Implement `installAgentPack`, `removeAgentPack`, `infoAgentPack` end-to-end against the fake; cover atomic-swap, drift detection, runtime-dir preservation | Phase 1 |
| 3 | Real fetch — GitHub tarball download + extract | runner | Real `IAgentPackFetcher` impl using Node `fetch()`; tarball extractor with security guards (size cap, path traversal, top-level-prefix strip) | Phase 1 |
| 4 | CLI surface + UX | cli | `minih agent install|info|list|remove` subcommands; flag set; confirmation prompt; `minih list` alias; JSON envelope; self-install detection | Phase 2, 3 |
| 5 | Registry seed + dogfood — `code-review-companion` end-to-end | runner + cli | Author `agent.json` for `code-review-companion`; create `agents-registry.json` with one entry; extend `scripts/copy-schemas.js`; manual end-to-end verify in fresh test project | Phase 4 |
| 6 | Docs + release notes | docs | `docs/how/agent-pack.md`; README/AGENTS.md/AGENTS_README.md updates; domain.md history rows; release-please commit messaging | Phase 5 |

## Harness Strategy

**Not applicable** — user override per spec § Clarifications Q6: this is a CLI install + file I/O + HTTP feature; existing `just fft` test gate plus Phase 5 manual end-to-end verification covers the feedback loop. No `docs/project-rules/harness.md` exists in the repo and one is not introduced by this plan.

## Phase 1: Foundations

**Objective**: Establish types, manifest validator, registry reader, source sidecar, and `IAgentPackFetcher` injection seam.
**Domain**: runner
**Delivers**:
- `src/runner/agent-pack/types.ts` (contract)
- `src/runner/agent-pack/manifest.ts` (read/validate `agent.json`)
- `src/runner/agent-pack/registry.ts` (read registry catalog)
- `src/runner/agent-pack/source.ts` (`.minih-source.json` r/w + checksums)
- `src/runner/agent-pack/fetcher.ts` (`IAgentPackFetcher` + `FakeAgentPackFetcher`)
- `src/runner/agent-pack/url.ts` (parse npm-style + HTTPS subpath syntax)
- `src/runner/agent-pack/index.ts` (re-exports)

**Depends on**: None.
**Key risks**: Manifest schema gets contentious — anchor on the workshop decision and don't invent new fields. Schema evolution covered by `schemaVersion: "1"` baked in from day 1.

| # | Task | Domain | Success Criteria | Notes |
|---|---|---|---|---|
| 1.1 | Create `src/runner/agent-pack/` directory + `types.ts` defining `AgentPackManifest` (with `files: Array<{path, description}>`), `AgentPackSource`, `RegistryEntry`, `InstallAction` enum (`'installed' \| 'upgraded' \| 'unchanged' \| 'removed'`), `ResolverDiagnostic` reuse from existing patterns | runner | `npm run build` clean; types exported via `index.ts` | Per workshop manifest schema |
| 1.2 | Implement `manifest.ts` — `readAgentManifest(dir)`, `validateManifest(manifest)`, `synthesizeImplicitManifest(dir)`. Validation: paths must be relative + path-traversal-safe; reject `runs/`, `inbox/`, `state/`, `.git/`; require `prompt.md` in `files[]`. | runner | TDD: 20+ unit tests cover happy path + every reject case (`..`, leading `/`, null byte, runtime-dir, missing prompt.md) | Finding 03 |
| 1.3 | Implement `registry.ts` — read `agents-registry.json` from `dist/templates/` via `import.meta.url` (matches `init.ts:160` pattern); `resolveRegistrySlug(slug)`; `listRegistryAgents()`; "did you mean" via existing Levenshtein helper if it exists, else inline | runner | TDD: covers slug hit, slug miss, Levenshtein hint at distance ≤2, malformed catalog file | Finding 06 |
| 1.4 | Implement `source.ts` — `readSourceSidecar(agentDir)`, `writeSourceSidecar(agentDir, sidecar)`, `computeFileChecksums(agentDir, files)`, `verifyChecksums(...)`. Schema: `{schemaVersion: "1", slug, source, installedAt, manifestVersion, fileChecksums}`. | runner | TDD: round-trip read/write; checksum compute deterministic; missing sidecar returns `null` cleanly | Finding 05 |
| 1.5 | Implement `fetcher.ts` — `IAgentPackFetcher` interface with `fetchTarball(url, ref): Promise<{commitSha, tarball: Buffer}>`. Real impl class `GitHubAgentPackFetcher` is a stub returning unimplemented in this phase (built in Phase 3). `FakeAgentPackFetcher` accepts a map of `(url+ref)` → `{commitSha, tarball}` set by tests. | runner | TDD: Fake covers happy path + "url not registered with fake" rejection | Finding 01 |
| 1.6 | Implement `url.ts` — parse `github:owner/repo[#ref][:subpath]` (npm-style), full HTTPS URLs, file paths. Output: normalized `{type: 'github'\|'git'\|'local', owner?, repo?, ref?, subpath?, raw}`. Canonical render for error messages. | runner | TDD: 15+ test cases across all three syntax forms; round-trip parse → render | Spec Q8 |
| 1.7 | Wire `src/runner/index.ts` to re-export public agent-pack surface from `agent-pack/index.ts` | runner | `cli` can `import { …, IAgentPackFetcher } from '../../runner/index.js'` | Composition prep |
| 1.8 | Add error codes E180-E184 to `src/cli/output.ts` | cli | TS compiles; `ErrorCodes.AGENT_PACK_REGISTRY_MISS = 'E180'` etc. exported | Cross-domain edit, foundational |

**Acceptance criteria**:
- All Phase 1 unit tests pass.
- `IAgentPackFetcher` interface stable enough that Phase 2 can build against it without changes.
- No new external dependencies added yet.

**Risks**:

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Manifest schema becomes a moving target as edge cases surface | medium | medium | Lock fields in 1.1; TODO any v2 candidates clearly marked in code comments |
| `import.meta.url` resolution breaks across npm-link vs npx vs global install | low | high | Match existing pattern from `init.ts:160` (already verified across all three) |

## Phase 2: Local install path with FakeAgentPackFetcher

**Objective**: End-to-end install/upgrade/info/remove against the fake fetcher; covers atomic-swap, drift detection, runtime-dir preservation, action-discriminator output.
**Domain**: runner
**Delivers**:
- `src/runner/agent-pack/install.ts`
- `src/runner/agent-pack/remove.ts`
- Full unit + integration test coverage of the install state machine

**Depends on**: Phase 1.
**Key risks**: Atomic-swap algorithm partial-failure recovery (Finding 02) — gets its own task. Don't ship until cross-platform tested (Linux + macOS at minimum).

| # | Task | Domain | Success Criteria | Notes |
|---|---|---|---|---|
| 2.1 | Implement `installAgentPack({slug?, url?, ref?, subpath?, agentsDir, fetcher, asSlug?, force?, yes?})` — orchestrates resolve source → fetch via fetcher → extract to temp → read manifest → validate → determine action (install/upgrade/no-op) | runner | Unit: action discriminator correct in all 4 branches; returns structured result with diagnostics | Finding 01 + spec AC1, AC2, AC3 |
| 2.2 | Implement atomic-swap in `install.ts` — for upgrade: write new files to `<slug>/.swap-<ts>/`, then rename each manifest-listed file into place; on any failure, rollback by restoring from `<slug>/.swap-<ts>/.backup/` | runner | TDD: simulate mid-swap failure; verify all files either fully old or fully new state, never mixed | Finding 02; spec AC2 |
| 2.3 | Surgical sync — files in OLD manifest but not in NEW manifest are deleted from disk during upgrade | runner | TDD: upgrade where new manifest drops `examples/sample.md`; confirm file removed; runtime dirs untouched | Spec AC2 / clarify Q2 |
| 2.4 | Runtime-dir preservation guard — `runs/`, `inbox/`, `state/` are filtered out of swap operations regardless of manifest claims | runner | TDD: malicious manifest claiming to "install" `runs/foo` is rejected at validation step (Finding 03); legitimate upgrade with existing `runs/` data preserves all entries | Findings 02, 03 |
| 2.5 | Implement `infoAgentPack(slug, agentsDir, {checkRemote: false, fetcher})` — read sidecar, manifest, frontmatter; compute checksum drift status per file; if `checkRemote: true`, fetch HEAD via `fetcher` and compute commit lag | runner | TDD: drift detection (`✓`/`⚠️`/`✗`); offline default; `checkRemote` integration | Spec AC9 |
| 2.6 | Implement `listAvailableAgents()` (registry catalog) and `listInstalledAgents(agentsDir)` (existing `listAgents` reuse) — return enriched data with installed/source status | runner | TDD: cross-reference returns correct status per slug | Spec AC8 |
| 2.7 | Implement `removeAgentPack(slug, agentsDir, {keepRuntime, yes})` — confirmation logic stays in CLI; runner just executes. With `keepRuntime: true`, move `runs/`/`inbox/`/`state/` to `<agentsDir>/.archived/<slug>-<ts>/` before deleting agent dir | runner | TDD: keep-runtime archives correctly; without flag, runtime dirs removed | Spec AC10 |
| 2.8 | Implicit-manifest path — when fetched source has no `agent.json`, synthesize manifest from canonical-files (only files that exist in source) | runner | TDD: agent without `agent.json` installs with prompt.md + present-canonical files; absent canonical files don't error | Spec AC6 |
| 2.9 | Self-install detection — `detectMinihRepoCwd(cwd)` walks up looking for `package.json` with `name: "minih"`; if found AND target slug's resolved source matches the local repo path, refuse with E183 + `--as` hint. `--force` bypasses (logged as warning). | runner | TDD: minih-repo detection works; non-minih-repo unaffected; `--force` bypass works | Finding 04 / Spec AC11 |

**Acceptance criteria**:
- `installAgentPack` returns `{action: 'installed'|'upgraded'|'unchanged'|'removed', ...}` correctly across 5+ scenarios.
- Atomic-swap survives mid-execution crash test (using process.exit injection in test).
- Runtime dirs preserved across all upgrade paths.
- All Phase 1 + 2 unit tests pass; coverage ≥85% on `agent-pack/` module.

**Risks**:

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Atomic swap edge cases on Windows (cross-volume rename) | medium | medium | Same-filesystem-rename works on most setups; document Windows test as v2 follow-up if reported |
| Test flake from temp-dir cleanup | low | low | Use `fs.mkdtemp` + try/finally cleanup pattern (existing in codebase) |

## Phase 3: Real fetch — GitHub tarball download + extract

**Objective**: Real `IAgentPackFetcher` impl backed by Node `fetch()` against GitHub REST API; tarball extractor with security guards.
**Domain**: runner
**Delivers**:
- `GitHubAgentPackFetcher` real implementation in `fetcher.ts`
- `extractor.ts` — tarball → temp dir, with size cap, traversal/symlink defense, top-level-prefix strip
- Optional new dep: `tar-stream` (or hand-rolled minimal reader — decided after R2 deepresearch)

**Depends on**: Phase 1.
**Key risks**: Untrusted-tar extraction is a known security category. Treat every extracted entry as adversarial.

| # | Task | Domain | Success Criteria | Notes |
|---|---|---|---|---|
| 3.1 | Run R2 deepresearch (tarball-extract patterns in modern Node) before writing extractor — informs dep choice | runner | Decision recorded in `external-research/tarball-extract.md`; `package.json` deps updated if a dep is chosen | R2 from research-dossier |
| 3.2 | Implement `GitHubAgentPackFetcher` — `fetchTarball(url, ref)` calls `GET https://api.github.com/repos/{owner}/{repo}/tarball/{ref}` with `Accept: application/vnd.github+json`, follows 302, reads tarball with 10 MB cap, captures redirect URL's commit sha (GitHub embeds it). User-Agent header `minih/<version>` per GitHub etiquette. | runner | TDD: mock `fetch()` happy path + 404 + 302 + body-too-large + network error; integration test gated `MINIH_E2E=1` against real GitHub API | Finding 07; spec AC4, AC14 |
| 3.3 | Implement `extractor.ts` — `extractTarball(buffer, destDir, opts)`. Streams via `node:zlib.createGunzip()` + chosen tar parser. Per-entry checks: reject `..`, leading `/`, symlinks, file mode beyond `0o755`. **DoS guards** (this is untrusted input — treat every entry as adversarial): cumulative-decompressed-size cap (10 MB total), per-entry size cap (2 MB), max entry count (200), max path length (255 bytes), max expansion ratio (compressed → decompressed) of 100x with early-abort, max gunzip stream wall-clock budget (5s soft) to defend against gzip-decompression bombs. Strip top-level `<repo>-<sha>/` prefix. | runner | TDD: 30+ test cases — happy path, traversal entries, symlinks, size overflow, **decompression bomb (1 MB compressed → 1 GB decompressed)**, **entry-count flood (10,000 small entries)**, **path-length attack (4 KB entry name)**, malformed tar | Findings 07, 09; spec AC15, AC7 |
| 3.4 | Wire `installAgentPack` to use `GitHubAgentPackFetcher` when not in test mode; CLI command receives `IAgentPackFetcher` from composition root | runner | Phase 2 tests still pass with Fake; new integration test (no `MINIH_E2E`) covers the wiring sans-network via Fake | Finding 01 |
| 3.5 | Add `MINIH_E2E=1` real-fetch end-to-end test: `minih agent install code-review-companion` succeeds against actual `github:AI-Substrate/minih` | runner | `MINIH_E2E=1 npx vitest run test/e2e/agent-pack-real-fetch.test.ts` green | Spec AC1 dogfood; matches existing `MINIH_E2E` convention |

**Acceptance criteria**:
- Real fetch works against `github:AI-Substrate/minih@main:agents/code-review-companion`.
- Tarball size cap rejects oversized payloads with E182 BEFORE extraction.
- Extractor refuses every traversal/symlink/size-overflow case.
- No real GitHub calls in `npm test` (default suite).

**Risks**:

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| GitHub API rate limit (60/hour anon) trips during E2E | medium | low | E2E tests gated `MINIH_E2E=1`; CI doesn't hit them |
| `fetch()` redirect handling differs by Node minor | low | medium | Test on Node 20.19 (project minimum) + 22 (latest LTS) |
| Tar parser dep introduces transitive deps with vulns | low | medium | Audit step in `just fft` already covers it; choose `tar-stream` known-clean |
| Gzip-decompression bomb / entry-count flood / path-length attack | medium | high | Per-task 3.3: cumulative size cap 10 MB, per-entry cap 2 MB, max entry count 200, max path length 255 B, expansion ratio cap 100x with early-abort, gunzip wall-clock budget 5s soft. TDD covers each attack class explicitly. |

## Phase 4: CLI surface + UX

**Objective**: User-facing CLI subcommands wired up; flags, confirmation, JSON envelope, error paths, `minih list` aliasing all work end-to-end.
**Domain**: cli
**Delivers**:
- `src/cli/commands/agent.ts` — subcommand group registration + each verb's action
- `src/cli/commands/list.ts` extended for `--available` / `--all`
- `src/cli/index.ts` updated to register the new command group
- CLI integration tests via `execSync` against built `dist/cli/index.js`

**Depends on**: Phase 2 + Phase 3.
**Key risks**: `minih list` aliasing must not break existing users — backward-compat tests required.

| # | Task | Domain | Success Criteria | Notes |
|---|---|---|---|---|
| 4.1 | Create `src/cli/commands/agent.ts` with `registerAgentCommand(program)`; subcommand group with `install`, `info`, `list`, `remove` verbs; flag parsing per workshop table | cli | `minih agent --help` shows all 4 verbs; each verb's `--help` shows correct flags | Workshop CLI table |
| 4.2 | Implement `agent install <ref>` action — composition root: instantiates `GitHubAgentPackFetcher`, calls `installAgentPack`, formats JSON envelope with `action` discriminator, writes human-readable stderr | cli | Integration: `minih agent install code-review-companion --yes` (against fake fetcher via env-injection) returns ok envelope with `action: 'installed'`; second run returns `action: 'unchanged'` | Spec AC1, AC2, AC3, AC13 |
| 4.3 | Implement confirmation prompt for non-registry URLs — uses `process.stdin` + `process.stderr` for prompt; respects `--yes` / non-TTY auto-bypass | cli | Integration: TTY-mode prompts; `--yes` bypasses; non-TTY without `--yes` exits with E108 (input required) | Spec AC4, clarify Q10 |
| 4.4 | Implement `agent info <slug>` action — formats provenance + manifest + per-file drift status; `--check-remote` adds upstream comparison | cli | Integration: post-install `agent info` shows full provenance; `--check-remote` shows commit lag | Spec AC9 |
| 4.5 | Implement `agent list [--available\|--all]` action — composition + table rendering | cli | Integration: default = installed; `--available` = registry; `--all` = both with status column | Spec AC8 |
| 4.6 | Extend `src/cli/commands/list.ts` to alias `agent list` semantics — `minih list` (no flag) behaves as today (installed); `minih list --available` and `minih list --all` work too | cli | Backward-compat: `MINIH_REGRESSION=1` baseline `minih list` output unchanged for existing agents | Spec AC8 (alias); clarify Q4 |
| 4.7 | Implement `agent remove <slug>` action — confirmation prompt + flag handling + `--keep-runtime` archival | cli | Integration: removes agent + archives runtime when flag set | Spec AC10 |
| 4.8 | Implement self-install detection at CLI level — calls runner's `detectMinihRepoCwd`; emits E183 with `--as` hint | cli | Integration test from inside fixture minih-repo cwd is rejected; from a fresh tmp project succeeds | Finding 04; Spec AC11 |
| 4.9 | Wire `registerAgentCommand` into `src/cli/index.ts` | cli | `minih --help` lists `agent` group | Composition |
| 4.10 | Subprocess injection seam — `MINIH_AGENT_PACK_FETCHER=fake:<json-fixture>` env var, read in command composition root, swaps in `FakeAgentPackFetcher` for test scenarios | cli | All CLI integration tests run without network | Finding 01 |

**Acceptance criteria**:
- All spec ACs 1-15 pass via the CLI surface.
- `minih list` backward-compat regression baseline (with `MINIH_REGRESSION=1`) is green.
- JSON envelopes match the contract documented in spec AC13.
- All flag combinations have at least one integration test.

**Risks**:

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Confirmation prompt UX awkward in non-TTY CI | medium | low | Detect non-TTY → require `--yes`; clear error if missing |
| Fetcher injection env var mechanism leaks into prod | low | medium | Validate env var only when `NODE_ENV=test` OR explicit dev flag; fail closed in production |

## Phase 5: Registry seed + dogfood — `code-review-companion` end-to-end

**Objective**: Author the canonical agent's `agent.json`, populate the registry, ship in `dist/templates/`, and verify the headline scenario (`minih agent install code-review-companion` in a fresh project) works against real GitHub.
**Domain**: runner + cli (composition)
**Delivers**:
- `agents/code-review-companion/agent.json`
- `src/templates/agents-registry.json` (one entry)
- `scripts/copy-schemas.js` extension
- `dist/templates/agents-registry.json` (built artifact)
- Manual end-to-end demo passing in fresh test project

**Depends on**: Phase 4.
**Key risks**: The dogfood agent's `agent.json` is the canonical reference example; mistakes here propagate. Two reviewers (one human, one companion) before merging.

| # | Task | Domain | Success Criteria | Notes |
|---|---|---|---|---|
| 5.1 | Author `agents/code-review-companion/agent.json` — list all 6 files (`prompt.md`, `instructions.md`, `outside.md`, `output-schema.json`, `inside-state.schema.json`, `outside-state.schema.json`) with concrete descriptions; `version: "0.1.0"`; tags `["companion", "review", "coordination"]` | runner | `minih agent install code-review-companion` (in tmp project, against built CLI) installs all 6 files; `minih agent info` shows each description | Finding 10; spec AC1 |
| 5.2 | Create `src/templates/agents-registry.json` with one entry for `code-review-companion` (per workshop) | runner | File exists; JSON parses; `since: "0.4.0"`, `minihVersion: ">=0.3.0"` | Spec headline use case |
| 5.3 | Extend `scripts/copy-schemas.js` to copy `agents-registry.json` to `dist/templates/` | build | `npm run build` produces `dist/templates/agents-registry.json` matching source | Workshop build pipeline |
| 5.4 | Manual end-to-end verification — fresh project (`mktemp -d && cd $_ && minih agent install code-review-companion`) succeeds within the spec AC1 performance target, run folder structure correct, `minih run code-review-companion` works | runner + cli | Recorded in `execution.log.md` with measured wall-clock from spec AC1 | Spec AC1 |
| 5.5 | Add `MINIH_REGRESSION=1`-gated baseline test for `minih agent list --available` output (so registry catalog changes are caught in PRs) | runner | `MINIH_REGRESSION=1 npm test` green; baseline file checked in | Existing convention |

**Acceptance criteria**:
- Headline demo (`minih agent install code-review-companion` from fresh project) succeeds against real GitHub within the spec AC1 performance target.
- All 15 spec ACs verified at least once.
- `just fft` green.
- `MINIH_E2E=1 npm test` green.

**Risks**:

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `code-review-companion`'s prompt has minih-internal references that break in a fresh non-minih project | medium | medium | Audit prompt for project-specific paths/assumptions; generalize before tagging release. May surface as a small follow-up before this phase ends. |
| Demo wall-clock exceeds spec AC1 performance target (esp. with cold network) | low | low | Spec AC1 is the canonical user-observable bar; document slowest observed in execution log if exceeded |

## Phase 6: Docs + release notes

**Objective**: Ship documentation + cross-references so users can discover and self-onboard.
**Domain**: docs (cross-domain — touches multiple domain.md files)
**Delivers**:
- `docs/how/agent-pack.md` (new)
- README.md "Agent Packs" section
- AGENTS.md companion-mode section update
- AGENTS_README.md install/getting-started update
- `docs/domains/cli/domain.md` history + composition
- `docs/domains/runner/domain.md` history + composition + Concepts table update
- Conventional commit messages set up release-please's changelog

**Depends on**: Phase 5.
**Key risks**: None significant — pure documentation. But neglecting it kills discoverability.

| # | Task | Domain | Success Criteria | Notes |
|---|---|---|---|---|
| 6.1 | Author `docs/how/agent-pack.md` — full surface, manifest format, sidecar format, security model, error reference, troubleshooting | docs | Reviewed; renders correctly in GitHub; cross-links from README/AGENTS | Spec docs strategy |
| 6.2 | Update `README.md` — new "Agent Packs" section with 3-line demo + link to docs/how/ | docs | New section is discoverable at first-glance browse of README (no scrolling required for the section heading) | Spec docs strategy |
| 6.3 | Update `AGENTS.md` — extend "Companion-mode is mandatory" section with `minih agent install code-review-companion` as the canonical setup | docs | Companion-mode setup is one fewer step (skip hand-copy) | Plan 016 cross-link |
| 6.4 | Update `AGENTS_README.md` — install/getting-started section mentions `agent` subcommand | docs | Discoverable from CLI footer (`minih --help` already points here) | Spec docs strategy |
| 6.5 | Update `docs/domains/cli/domain.md` — history row + composition row for `commands/agent.ts` | docs | Domain doc current per existing convention | Domain.md update rule |
| 6.6 | Update `docs/domains/runner/domain.md` — history row + composition for `agent-pack/` + new exported contracts in Concepts table | docs | Domain doc current; Concepts table has agent-pack entry | Domain.md update rule |
| 6.7 | Update `docs/domains/domain-map.md` if needed (likely only label refinements, no new edges) | docs | Map current; no new cross-domain edges introduced (verified) | Domain map update rule |
| 6.8 | Conventional commits for release-please — `feat(cli):` and `feat(runner):` for the headline; `docs:` for Phase 6 work | release | Subsequent release-please run picks up agent-pack feature in changelog | Plan 004 release-please convention |

**Acceptance criteria**:
- All docs render correctly in GitHub.
- `just fft` green (docs don't break tests).
- Conventional commit messaging respected.

**Risks**:

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Docs drift from implementation | low | medium | Phase 6 happens AFTER phases 1-5 land; docs reflect actual surface |

## Acceptance Criteria

(Cross-reference to spec — each acceptance criterion in the spec is verified by at least one task in the phases above. Listed here for ease of reference.)

- [ ] **AC1** Headline install (registry slug) succeeds within the spec performance target — verified Phase 5.4
- [ ] **AC2** Idempotent install = upgrade with runtime preservation — verified Phase 2.2-2.4
- [ ] **AC3** No-op install reports `action: "unchanged"` — verified Phase 2.1
- [ ] **AC4** Direct git URL install with confirmation — verified Phase 4.3
- [ ] **AC5** Manifest with arbitrary extras — verified Phase 1.2 + 2.1 + 4.4
- [ ] **AC6** Implicit-manifest fallback — verified Phase 2.8
- [ ] **AC7** Path-traversal & runtime-dir defense — verified Phase 1.2 + 3.3
- [ ] **AC8** List installed vs available; `minih list` alias — verified Phase 4.5 + 4.6
- [ ] **AC9** Info shows provenance + drift — verified Phase 2.5 + 4.4
- [ ] **AC10** Remove with safety + `--keep-runtime` — verified Phase 2.7 + 4.7
- [ ] **AC11** Self-install protection — verified Phase 2.9 + 4.8
- [ ] **AC12** Registry curation enforced — verified Phase 1.3
- [ ] **AC13** JSON envelope contract — verified Phase 4.2
- [ ] **AC14** Network failure is loud — verified Phase 3.2
- [ ] **AC15** 10 MB tarball cap — verified Phase 3.3

## Fixes

| ID | Created | Summary | Domain(s) | Status | Source |
|----|---------|---------|-----------|--------|--------|
| FX001 | 2026-05-03 | Local-path install — vertical slice of `minih agent install` (subsumes part of Phase 2 + Phase 4 for the local source branch). URL/registry stub with E182 "not yet available" until Phase 3/4 land. | runner + cli | Complete | User proposal: "what about we upgrade the command to give a local file path" |

## Risks (Plan-Level)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| First HTTP code introduces test flake | medium | medium | `IAgentPackFetcher` injection seam (Phase 1.5); E2E gated `MINIH_E2E=1` (Phase 3.5) |
| Atomic-swap edge cases on cross-platform | medium | medium | Same-filesystem rename is portable; document Windows as v2 follow-up |
| Tar parser dep introduces vulns | low | medium | `just fft` audit step covers transitive deps; choose well-maintained dep |
| Self-install footgun in dogfood | medium | medium | Phase 2.9 detection + `--as` escape hatch; tested in Phase 4.8 |
| Code-review-companion not portable to fresh project | medium | medium | Phase 5.1 audit before publishing |
| Untrusted-tar attack surface (decompression bombs, entry floods, traversal, symlinks) | medium | high | Phase 3.3 implements per-entry + cumulative DoS guards; TDD covers every named attack class |
| `dist/templates/agents-registry.json` shape drift breaks users on stale CLI | low | medium | Catalog has `version: "1"` field from day 1; reader tolerates unknown fields (forward-compat) and refuses unsupported versions with clear error; Phase 1.3 includes a malformed-catalog test case |
| `IAgentPackFetcher` interface churn between Phase 1 and Phase 4 forces rework | low | medium | Phase 1.5 task bakes in compile-time consumer test (Phase 2's install.ts compiles against the interface) before declaring Phase 1 done |
| `MINIH_REGRESSION=1` baseline drift conflated with real regressions | medium | low | Baseline updates only land in dedicated PRs labeled `baseline-update`; unexpected diffs in any other PR fail CI per existing convention |

## Open Questions / Watchpoints

- **R2 deepresearch (tarball-extract patterns)** — runs at start of Phase 3; informs dep choice. If postponed, Phase 3 risks higher novelty score.
- **Workshop W2 (atomic-swap algorithm)** — Phase 2.2 may surface a need to deepen the workshop. If task feels speculative, pause and run `/plan-2c-v2-workshop` first.
- **Backward-compat baseline for `minih list`** — Phase 4.6 must update `MINIH_REGRESSION=1` baseline output if list output gains new columns; coordinate with whichever PR lands first.

---

**Next step**: Run **/plan-5-v2-phase-tasks-and-brief** for Phase 1 (plan-4 + validate-v2 already passed).

---

## Validation Record (2026-05-03)

Two validation passes:

**Pass 1 — `/plan-4-v2-complete-the-plan`** (3 validators: Structure, Testing Alignment, Domain Completeness; Doctrine + ADR N/A — no `docs/project-rules/` or `docs/adr/`):

| Agent | Lenses Covered | Issues | Verdict |
|-------|---------------|--------|---------|
| Structure | structural completeness, heading hierarchy, cross-refs | 1 HIGH (time language) → fixed; date metadata kept (matches skill template) | ⚠️ → ✅ |
| Testing Alignment | testing approach × spec | 0 | ✅ PASS |
| Domain Completeness | domain coverage, classification consistency | 1 MEDIUM (Phase 6 should also update Contracts/Composition not just Concepts) **OPEN**; 1 LOW (`fetcher.ts` dual classification) **OPEN** | ⚠️ |

**Pass 2 — `/validate-v2`** (4 validators: Coherence, Risk, Completeness, Forward-Compatibility):

| Agent | Lenses Covered | Issues | Verdict |
|-------|---------------|--------|---------|
| Coherence | System Behavior, Integration & Ripple, Hidden Assumptions | 0 | ✅ PASS |
| Risk | Edge Cases & Failures, Security & Privacy, Deployment & Ops | 2 HIGH → fixed, 2 MEDIUM **OPEN** | ⚠️ → ✅ |
| Completeness | Hidden Assumptions, Concept Documentation, Domain Boundaries | 1 HIGH → fixed, 3 MEDIUM **OPEN**, 1 LOW **OPEN** | ⚠️ → ✅ |
| Forward-Compatibility | Forward-Compatibility, Technical Constraints, User Experience | 1 MEDIUM → fixed (rolled into the manifest fix) | ⚠️ → ✅ |

**Lens coverage**: 11/12 (above the 8-floor; only Performance & Scale uncovered, which is N/A for a planning artifact).

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| Phase 1 dossier (next-phase canonical) | concrete tasks with paths + criteria | shape mismatch | ✅ | Phase 1 has 8 numbered tasks with absolute paths and concrete success criteria |
| Phase 6 docs consumers | stable surface description | contract drift | ✅ | Phase 6 docs tasks name the full surface, manifest, sidecar, and domain updates after Phases 1-5 land |
| Future implementer (plan-6) | Domain Manifest covers every touched file | shape mismatch | ✅ (after fix) | Domain Manifest now includes `dist/templates/agents-registry.json` + `docs/domains/domain-map.md` |
| Existing minih CLI users | backward-compat baseline preserved | contract drift | ✅ | `minih list` aliasing + `MINIH_REGRESSION=1` baseline explicit; new MINIH_REGRESSION drift-policy risk row added |

**Outcome alignment**: "With `minih agent install code-review-companion`, adoption becomes one command. The harness becomes shareable, which is how velocity compounds across teams." — the artifact, after fixes, advances this outcome: the install path is end-to-end coherent across phases, security guards are explicit, and the Domain Manifest is complete enough for plan-6 to apply domain placement rules.

**Standalone?**: No — Phase 1 tasks dossier is the immediate next-phase consumer, the spec contract is binding, and the user-value chain depends on the plan's shape.

### Fixes applied (HIGH from validate-v2 — 3 of 3)

| ID | Source | Fix |
|---|---|---|
| Risk-H1 | Risk | Phase 3.3 now lists explicit DoS guards (cumulative cap 10 MB, per-entry 2 MB, max-entries 200, max-path-length 255 B, expansion ratio 100x with early-abort, gunzip wall-clock budget). TDD scope expanded to 30+ test cases including decompression bomb, entry-count flood, path-length attack. New Phase 3 risk row added. |
| Risk-H2 | Risk | Plan-Level Risks gained: registry artifact shape drift / rollback compatibility row (mitigated by `version: "1"` field + tolerant reader + Phase 1.3 malformed-catalog test). |
| Comp-H1 | Completeness | Domain Manifest now includes `dist/templates/agents-registry.json` (build / shipped artifact) — closes the gap Forward-Compat MEDIUM also flagged. |

### Fixes also applied (MEDIUM that were trivial)

| ID | Source | Fix |
|---|---|---|
| FC-M1 | Forward-Compat | Domain Manifest now includes `docs/domains/domain-map.md` row for Phase 6.7 (one-line addition; was the same class of issue as Comp-H1). |
| Risk-M2 | Risk | Plan-Level Risks gained: `IAgentPackFetcher` interface churn risk + lock-the-contract-via-compile-time-test mitigation (Phase 1.5). |
| Risk-M3 | Risk | Plan-Level Risks gained: `MINIH_REGRESSION=1` baseline drift policy row (baseline updates land in dedicated PRs labeled `baseline-update`). |

### Open (deferred per user directive "fix all HIGH" — surface for follow-up)

| ID | Severity | Source | Issue | Disposition |
|---|---|---|---|---|
| Plan-4 Domain MEDIUM | MEDIUM | plan-4 | Phase 6 Concepts-only update insufficient; should also touch Contracts + Composition on `runner/domain.md` | Address in plan-5 Phase 6 dossier or during plan-6 implementation. Plan task 6.6 should be expanded then. |
| Plan-4 Domain LOW | LOW | plan-4 | `fetcher.ts` dual `contract + internal` classification | Address in Phase 1 implementation by either splitting into `fetcher-types.ts` (contract) + `fetcher.ts` (internal) OR documenting the dual role in the manifest. Architectural call deferred to plan-6 implementer. |
| Comp-M1 | MEDIUM | validate-v2 | Plan assumes Node `fetch()` works without proxy/CA flags; corporate-proxy users may hit silent failures | Add to spec Open Questions for v2 (proxy support); Phase 3.2 task already gives clear E181 error path which surfaces the failure loudly. Not blocking v1 since `MINIH_E2E=1` test verifies the happy path. |
| Comp-M2 | MEDIUM | validate-v2 | Phase 6.6 vague on which Concepts/Contracts entries to add | Plan-5 dossier for Phase 6 will expand this; not blocking plan-3 acceptance. |
| Comp-M3 | MEDIUM | validate-v2 | AC-to-task cross-reference uses task numbers without spelling out task titles | Plan-5 dossier for each phase will rebuild the trace explicitly during task expansion. |
| Comp-LOW | LOW | validate-v2 | CS-3 may be slightly optimistic given first HTTP code + 3 new persisted formats; could justify CS-4 | Leave at CS-3 for now; if Phase 1 or Phase 3 surfaces unexpected complexity, escalate via mid-stream re-score. CS scoring is informational not blocking. |

**Overall**: ⚠️ VALIDATED WITH FIXES — all HIGH addressed (4 fixes); 3 MEDIUM also fixed; 6 MEDIUM/LOW deferred to plan-5 / plan-6 / spec follow-up per user directive. Plan is ready for `/plan-5-v2-phase-tasks-and-brief`.

**Outcome alignment**: "With `minih agent install code-review-companion`, adoption becomes one command. The harness becomes shareable, which is how velocity compounds across teams." — the artifact, after fixes, advances this outcome: the install path is end-to-end coherent across phases, security guards are explicit, and the Domain Manifest is complete enough for plan-6 to apply domain placement rules.
