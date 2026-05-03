# Agent Pack Install

**Mode**: Full

> 📚 This specification incorporates findings from `research-dossier.md`, `external-research/distribution-standards.md`, and `workshops/001-cli-shape.md`. Decisions taken in the workshop are treated as authoritative.

## Research Context

- **Plan 016 made companions load-bearing.** With `code-review-companion` now mandatory for code-editing sessions, sharing it across projects is the next velocity bottleneck.
- **The closest fit standard is Claude Code Plugin Marketplaces** (Anthropic, 2025) — git-repo-based catalog, folder = plugin, manifest-driven. Adopt this conceptual model.
- **AWS ARA spec** (Feb 2026) is a viable v2 north star (multi-source manifests). v1 stays git-only with ARA-compatible field names so future interop is cheap.
- **Distribution model**: per user direction, **bake only the GitHub URL pointers**, not the agent files. Agent updates flow through `main` independently of CLI releases.

## Summary

**WHAT**: Add a CLI surface to install, inspect, list, and remove minih agents from a baked-in registry of URL pointers OR from arbitrary git URLs. Each install drops a folder into the project's `agentsDir`, writes a provenance sidecar (`.minih-source.json`), and is idempotent — re-running `install` upgrades from the same source.

**WHY**: Today, sharing a curated agent (most acutely `code-review-companion`) across projects means hand-copying files. That's friction at the exact moment a new project would benefit most from picking up the harness's institutional knowledge. With `minih agent install code-review-companion`, adoption becomes one command. The **harness becomes shareable**, which is how velocity compounds across teams.

## Goals

- **One-command install of canonical agents**: `minih agent install code-review-companion` works in any project (with network) in <5 seconds.
- **Idempotent upgrade**: re-running the same `install` command pulls the latest commit and atomic-swaps source files, preserving runtime data (`runs/`, `inbox/`, `state/`).
- **Direct-URL install**: `minih agent install <git-url>` works for any public GitHub repo, with a confirmation prompt for non-registry sources.
- **Agent packs may carry arbitrary files**: per-agent `agent.json` manifest lists files with descriptions; install copies exactly the listed set.
- **Registry-driven curation**: only agents explicitly added to `src/templates/agents-registry.json` are installable by slug; the repo's `agents/` folder is NOT auto-discovered.
- **Provenance always recorded**: every install writes a sidecar that makes "where did this come from?" and "is there an upgrade available?" answerable offline.
- **Agent updates decoupled from CLI releases**: pushing a fix to `main` reaches users on their next install — no minih release required.
- **Discoverable**: `minih agent list --available` shows installable agents from the registry; `minih agent info <slug>` shows what an installed agent does + its provenance + each shipped file with a description.

## Non-Goals

- **Auto-discovery from `agents/`**: the registry is the only allowlist. Agents in the source repo that aren't registered stay invisible to install.
- **Bundling agent files in the npm package**: only the registry catalog ships in `dist/`. Files come from GitHub at install time.
- **Trust/verification tiers** (à la ANP/NANDA crypto-signed metadata): out of scope for v1. Confirmation prompt + commit sha display is the trust model.
- **Code execution at install time**: even if a manifest lists `scripts/install.sh`, the file is copied — never run.
- **Post-install hooks, file templating, dependency resolution**: deferred to v2.
- **`minih agent search <query>`**: deferred to v2; verb is reserved.
- **`.minih/marketplace.json` per-repo catalog**: deferred to v2; for v1 the registry covers the bundled-pointer case and raw URL covers everything else.
- **Third-party registry entries**: v1's registry only points at AI-Substrate/minih. Anyone can install third-party agents via raw URL; promoting them to the curated registry is a v2 conversation.
- **Version constraints / semver ranges in install**: v1 supports `--ref <branch|tag|sha>` for pinning; full constraint resolution is v2.
- **Replacing existing `minih list` / `minih init` / `minih doctor`**: those stay. New `minih agent <verb>` is purely additive.

## Target Domains

| Domain | Status | Relationship | Role in This Feature |
|---|---|---|---|
| `cli` | existing | **modify** | Add new `agent <verb>` subcommand group (`install`, `info`, `list`, `remove`); add error codes E180-E184; thin alias for existing `minih list` to map to `agent list` |
| `runner` | existing | **modify** | Add internal `agent-pack/` module: registry reader, source sidecar, fetcher, extractor, manifest validator, install/upgrade/remove orchestration |
| `adapter` | existing | **NOT involved** | n/a — agent-pack does not touch the SDK |
| `mcp` | existing | **NOT involved** | n/a — agent-pack does not touch coordination |

No new domains are created. The `runner` domain gains a self-contained sub-module (`agent-pack/`) — internal-only, not a separate domain — that owns the new file formats and remote-fetch behavior. CLI consumes via existing public-contract pattern (cross-domain imports from `runner/index.ts`).

### Domain map impact

```
cli (modify)
 └── new src/cli/commands/agent.ts (subcommand group)
       └── consumes runner/index.ts new exports

runner (modify)
 └── new src/runner/agent-pack/{index,registry,source,fetcher,extractor,install}.ts
 └── runner/index.ts re-exports public surface
```

No cross-domain edges added. `cli → runner` direction holds. `runner → adapter` unchanged.

## Complexity

**Score**: CS-3 (medium)
**Breakdown**: S=1, I=1, D=1, N=1, F=1, T=1 → P=6
**Confidence**: 0.80

- **Surface (S=1)**: Multiple new files across `cli` and `runner/agent-pack/`, plus `scripts/copy-schemas.js` extension; no cross-cutting refactor.
- **Integration (I=1)**: One external integration — GitHub HTTPS for tarball download. No GitHub auth required for public repos in v1.
- **Data/State (D=1)**: Three new on-disk formats (`agent.json`, `agents-registry.json`, `.minih-source.json`); no migration, no DB.
- **Novelty (N=1)**: Workshop has resolved most design questions; tarball-extract pattern needs validation (R1 from research-dossier).
- **Non-Functional (F=1)**: Confirmation UX for arbitrary URLs, 10 MB tarball cap, integrity checksums, atomic-swap-on-upgrade. Standard care, not strict compliance.
- **Testing (T=1)**: Need a `FakeAgentPackFetcher` injection seam (no real-GitHub tests in CI). Otherwise standard unit + integration approach.

**Assumptions**:
- Node 20+ built-in `fetch()` is sufficient for GitHub tarball download (R1 deepresearch may add a tar parser dep).
- The minih repo's `agents/<slug>/` folders are the canonical source; no file moves needed.
- `code-review-companion` is the only agent registered in v1; others promoted on a per-PR basis.
- `--agents-dir` global flag is the install destination (no separate `--install-path`).

**Dependencies**:
- Node ≥20.19 (already required).
- GitHub uptime at install time (mitigated: failure is loud, runtime never hits GitHub afterwards).
- Possibly one new npm dep (`tar-stream` or similar). To be confirmed in plan-3 architect after R1 deepresearch.

**Risks** (complexity-related):
- **First HTTP code in src/** — needs careful interface design (fetcher injection seam) to keep tests deterministic.
- **Atomic-swap on upgrade** — partial failures must not leave the agent folder broken (Workshop W2 on hold until plan-2c).
- **Self-install in the minih repo** — running `minih agent install <slug>` IN this repo would clobber the source. Detection + `--as <new-slug>` escape hatch.
- **Manifest tampering** — malicious `agent.json` claiming to ship `runs/...` paths could erase user runtime data. Path-traversal & runtime-dir denylist enforced at install time.

**Phases** (suggested high-level — finalized in plan-3):
1. **Foundations** — manifest types/schemas (`agent.json`, `agents-registry.json`, `.minih-source.json`), validators, `IAgentPackFetcher` interface + `FakeAgentPackFetcher`, no real network code yet
2. **Local install path** — install/info/list/remove against fake fetcher; sidecar write + read; atomic swap; preserve runtime dirs
3. **Real fetch** — GitHub tarball download + extract; HTTP error handling; 10 MB cap; size + commit-sha display in stderr
4. **CLI surface + UX** — `agent <verb>` subcommand wiring; `minih list` aliasing; confirmation prompt; `--check` / `--ref` / `--as` / `--from` flags; JSON envelope shape
5. **Registry seed + dogfood** — author `agent.json` for `code-review-companion`; add registry entry; ship in `dist/templates/`; verify `minih agent install code-review-companion` works end-to-end in a fresh test project
6. **Docs + releases** — AGENTS_README updates, changelog, release-please notes; doctor lite-check on installed agents (manifest checksum vs disk)

## Acceptance Criteria

1. **Headline install (registry slug)** — In a fresh project (no existing `agents/` dir), running `minih agent install code-review-companion` completes in <5 seconds (with network), creates `<cwd>/agents/code-review-companion/` containing all files listed in the registered manifest, writes `.minih-source.json` with `source.type: "registry"`, and ends with `minih run code-review-companion` working successfully.

2. **Idempotent install = upgrade** — Re-running `minih agent install code-review-companion` after upstream pushes a new commit fetches the new commit, atomic-swaps the manifest-listed files, preserves all `runs/`, `inbox/`, and `state/` data untouched, and updates `.minih-source.json` with the new commit sha. The CLI output reports `action: "upgraded"` (vs `"installed"` for fresh).

3. **No-op install** — Running `minih agent install code-review-companion` when local commit sha already matches remote HEAD reports `action: "unchanged"` and modifies no files.

4. **Direct git URL install** — `minih agent install github:owner/repo#ref:agents/some-agent` works for any public GitHub repo, prompts for confirmation (showing source URL, commit sha, file list, total size) before writing, accepts `--yes` to skip the prompt, writes `.minih-source.json` with `source.type: "url"`.

5. **Manifest with arbitrary extras** — An agent pack whose `agent.json` lists `prompt.md`, `instructions.md`, `examples/sample.md`, `scripts/post-install.sh`, and `README.md` installs all five files at the correct paths, and `minih agent info <slug>` displays each with its description from the manifest.

6. **Implicit-manifest fallback** — An agent pack with no `agent.json` in source installs the canonical-files set (`prompt.md`, optional `instructions.md`, `output-schema.json`, `input-schema.json`, `outside.md`, `inside-state.schema.json`, `outside-state.schema.json`) — anything else in the source folder is ignored.

7. **Path-traversal & runtime-dir defense** — A `agent.json` listing paths like `../etc/passwd`, `runs/something`, or `../../something` is rejected with E182 before any file is written; nothing in the user's filesystem is modified.

8. **List installed vs available** — `minih agent list` (no flag) shows installed agents in the project's `agentsDir`. `minih agent list --available` shows the registry catalog with installed/not-installed status. `minih list` (legacy) is preserved as an alias for `minih agent list`.

9. **Info shows provenance + drift** — `minih agent info code-review-companion` shows source URL, ref, commit sha, install date, manifestVersion, and per-file checksum status (`✓ unchanged` / `⚠️ modified` / `✗ missing`). With `--check-remote`, additionally shows "X commits behind / latest / drift" status.

10. **Remove with safety** — `minih agent remove <slug>` requires confirmation by default (`--yes` to skip); reports E121 if slug isn't installed; supports `--keep-runtime` to move `runs/`/`inbox/`/`state/` to `<agentsDir>/.archived/<slug>-<ts>/` before deleting the agent folder.

11. **Self-install protection** — Running `minih agent install code-review-companion` from inside the minih source repo (where `agents/code-review-companion/` already exists as the canonical source) refuses with an instructive error suggesting `--as <new-slug>`. The error does NOT block raw URL installs to a different slug.

12. **Registry curation enforced** — `minih agent install hello-world` (an internal-only test fixture in the minih repo, not in the registry) returns E180 AGENT_PACK_REGISTRY_MISS with a "did you mean" hint. The agent's existence in the source repo's `agents/` folder is invisible to the install path.

13. **JSON envelope contract** — Every `agent` subcommand writes a JSON envelope to stdout (per universal CLI convention) with the new `action` discriminator (`installed` / `upgraded` / `unchanged` / `removed`), and human-readable output to stderr. `--agents-dir <path>` is honored as the install destination.

14. **Network failure is loud** — If GitHub is unreachable, `minih agent install` exits with E181 and a clear retry suggestion. The user's local files are unchanged. Subsequent `minih run`/`view`/`outside` commands continue to work offline.

15. **10 MB tarball cap** — A fetched tarball exceeding 10 MB is rejected with E182 before extraction; no temp files persist; user is told the cap and which agent triggered it.

## Risks & Assumptions

### Assumptions
- AI-Substrate/minih's `main` branch is the canonical source for v1's only registered agent. Future entries may target tags or other branches via the `ref` field.
- Users have network access at install time but not necessarily afterwards; runtime never re-fetches.
- The minih CLI is installed via `npm install` (Plan 004) — its `dist/` is the location of the registry catalog. `import.meta.url` resolution (existing pattern) gives us the path.
- Curation is by PR review against `src/templates/agents-registry.json`; no automated promotion process in v1.

### Risks
- **GitHub uptime dependency at install time** — mitigated: failure is loud, runtime is offline, registry is local so `list --available` works without GitHub.
- **First HTTP code introduces test flake potential** — mitigated: `FakeAgentPackFetcher` injection seam designed up-front (Phase 1 task).
- **Future ARA / Claude-marketplace interop drift** — `agent.json` field names chosen to align with both standards; ARA's `name`/`version`/`description`/`type` already match. Migration cost stays low.
- **Self-install footgun in dogfood** — covered by AC11; verified by integration test.
- **Single-canonical-agent-only at launch** could feel underwhelming — but per workshop, deliberate restraint. Promotion of `feedback-digest` and `coordination-loop-validator` is a follow-up PR after generalization, not a Phase 5 deliverable.

## Open Questions

These remain for `/plan-2-v2-clarify`:

1. ~~**Q2** — On install-as-upgrade, do we delete files that existed in the old manifest but not in the new (surgical sync)?~~ ✅ **RESOLVED** (Clarifications session 2026-05-03): Yes — surgical sync per manifest. Files in old manifest but not new are removed; files outside manifest never touched.
2. ~~**Q3** — Does `minih agent info <slug>` check the remote by default, or only with `--check-remote`?~~ ✅ **RESOLVED**: Only with `--check-remote` flag. Default offline for speed.
3. ~~**Q4** — Is `minih list` deprecated in favor of `minih agent list`, or kept as an alias?~~ ✅ **RESOLVED**: Keep both. `minih list` is preserved as an alias for `minih agent list` (backward compat).
4. ~~**Q5** — Registry catalog format: JSON file under `src/templates/` or TypeScript const?~~ ✅ **RESOLVED**: JSON file at `src/templates/agents-registry.json`, copied to `dist/templates/agents-registry.json` via existing `scripts/copy-schemas.js` extension.
5. ~~**Q8** — Subpath URL syntax priority?~~ ✅ **RESOLVED**: All three accepted (`#ref:subpath` npm-style, `?path=` query, `--subpath` flag). npm-style fragment is canonical in error messages and `--help` output.
6. ~~**Q9** — `--ref` default behavior: HEAD or auto-discover latest tag?~~ ✅ **RESOLVED**: HEAD of default branch in v1. Tag-aware discovery deferred to v2.
7. ~~**Q10** — Confirmation prompt for non-registry URLs blocking-by-default, or warn-and-proceed?~~ ✅ **RESOLVED**: Blocking-by-default; bypassable with `--yes` for CI.
8. ~~**Q11** — Tarball size cap value?~~ ✅ **RESOLVED**: 10 MB for v1. Configurable later if real-world packs need it.

(Q1 and Q6 were resolved in the workshop.)

## Clarifications

### Session 2026-05-03

> User was unavailable during the clarify pass; the agent applied decisions consistent with established codebase patterns (Plan 007's IAgentAdapter/FakeAgentAdapter, Plan 016's e2e gating env vars, existing CLI subcommand-group convention) and the explicit user directives captured during the workshop session. All open spec questions (Q2-Q11) had been workshop-resolved already; this session formalized them.

**Q1 — Workflow Mode**: **Full Mode**.
- Rationale: CS-3 complexity score, 6 suggested phases, multi-file change across two domains. Matches minih's existing convention (Plans 007, 008, 010, 016 all Full Mode).
- Spec header updated to `**Mode**: Full`.

**Q2 — Testing Strategy**: **Hybrid** — TDD for state machinery + error paths; Lightweight for CLI composition.
- Rationale: The agent-pack module owns nontrivial state (sidecar, manifest, atomic swap, drift detection, install/upgrade/no-op branching) AND introduces the first HTTP code in the codebase. Both deserve test-first treatment. CLI command wiring is composition-heavy and traditionally well-served by integration tests against the built CLI (existing pattern).
- Per-task annotation:
  - `agent-pack/source.ts` (sidecar read/write): **Full TDD**
  - `agent-pack/registry.ts` (catalog read + slug resolution): **Full TDD**
  - `agent-pack/fetcher.ts` (GitHub fetch via `IAgentPackFetcher`): **Full TDD with FakeAgentPackFetcher**
  - `agent-pack/extractor.ts` (tarball → temp dir): **Full TDD** (security boundary)
  - `agent-pack/install.ts` (orchestration): **Full TDD**
  - `cli/commands/agent.ts` (subcommand wiring): **Lightweight** (subprocess `execSync` integration tests against built CLI)
- Spec gains `## Testing Strategy` section below.

**Q3 — Mock Usage**: **Option B — Targeted mocks, external systems only**.
- Rationale: Matches `IAgentAdapter`/`FakeAgentAdapter` pattern (`src/adapter/`). The new `IAgentPackFetcher` interface mirrors this exactly: real implementation uses Node `fetch()` against GitHub; tests use `FakeAgentPackFetcher` injected at the runner-level construction site.
- No real-GitHub calls in CI. Real-fetch end-to-end tests gated behind `MINIH_E2E=1` (matching existing convention from `test/e2e/two-agent-coordination.test.ts`).

**Q4 — Documentation Strategy**: **Option C — Hybrid (README + docs/how/)**.
- Rationale: This is a user-facing CLI feature significant enough to warrant a dedicated how-to. Quick-start lives in README; full surface + workflows in `docs/how/agent-pack.md`. AGENTS.md gains a one-paragraph note about `minih agent install code-review-companion` since the companion-mode rule already references the agent.
- Concrete docs deliverables:
  - **`README.md`** — new "Agent Packs" section with the 3-line install/info/upgrade demo + link to docs/how/.
  - **`docs/how/agent-pack.md`** — new file: full surface (install/info/list/remove), manifest format, sidecar format, security model, troubleshooting (E180-E184).
  - **`AGENTS.md`** — extend the "Companion-mode is mandatory" section to note that `minih agent install code-review-companion` is the canonical way to add it to a fresh project.
  - **`docs/domains/cli/domain.md`** — history row + new `agent` subcommand-group composition entry.
  - **`docs/domains/runner/domain.md`** — history row + new `agent-pack/` composition entry.
  - **`AGENTS_README.md`** — short paragraph in the install/getting-started section pointing at the `agent` subcommand.

**Q5 — Domain Review**: **Confirmed: cli (modify) + runner (modify), no new domain**.
- Rationale: The new `agent-pack` capability is internal infrastructure under `runner` (file I/O, fetching, extracting, manifest validation — all consistent with runner's existing role of "owns the file convention"). Exposing it via `runner/index.ts` re-exports keeps the cli→runner direction intact. Adapter and mcp are orthogonal.
- No domain map changes beyond domain.md history rows in `cli` and `runner`.

**Q6 — Harness Readiness**: **No harness exists; feature doesn't need one**.
- Rationale: `docs/project-rules/harness.md` does not exist in this repo. The feedback loop for this feature is **the existing minih test gate** (`just fft` covers lint/format/build/typecheck/test/audit). Plus dogfooding: implementation Phase 5 includes a manual end-to-end test (install `code-review-companion` in a fresh test project, verify `minih run` succeeds).
- No "Build harness as Phase 0" needed — the existing CI gate is the harness for non-coordination features. (Coordination features rely on the agent-side harness, which is separate.)
- Override reason logged here: feature is CLI install + file I/O + HTTP — fully testable via unit + integration + E2E without a Boot/Interact/Observe loop.

### Decisions cascading into the spec

The above resolved the following sections:
- **Mode**: header now `**Mode**: Full`.
- **Testing Strategy**: new section below, per-task annotations included.
- **Documentation Strategy**: new section below, files listed.
- **Target Domains**: confirmed unchanged.
- **Open Questions**: all 8 marked resolved.

## Testing Strategy

**Approach**: Hybrid — Full TDD for state-bearing logic (sidecar, manifest, fetcher, extractor, install orchestration); Lightweight for CLI subcommand wiring.

**Rationale**: The agent-pack module owns the nontrivial state machinery (idempotent install, atomic-swap upgrade, drift detection) AND introduces the first HTTP code in the codebase. Both warrant test-first treatment with explicit fake-injection seams. CLI subcommand registration is composition-heavy and well-served by `execSync` integration tests against the built CLI binary (matches existing pattern in `test/cli/*`).

**Mock Usage**: Option B — Targeted mocks, external systems only. New `IAgentPackFetcher` interface mirrors the existing `IAgentAdapter` pattern. CI uses `FakeAgentPackFetcher`. Real-network E2E tests gated behind `MINIH_E2E=1`.

**Focus areas (Full TDD)**:
- `src/runner/agent-pack/source.ts` — `.minih-source.json` read/write, schema, checksum verification
- `src/runner/agent-pack/registry.ts` — registry catalog read, slug resolution, did-you-mean (Levenshtein) hints
- `src/runner/agent-pack/manifest.ts` — `agent.json` read + path-traversal validation + runtime-dir denylist
- `src/runner/agent-pack/fetcher.ts` — `IAgentPackFetcher` interface + real (Node fetch) impl + `FakeAgentPackFetcher`
- `src/runner/agent-pack/extractor.ts` — tarball → temp dir + security checks (size cap, symlinks, traversal)
- `src/runner/agent-pack/install.ts` — install/upgrade/no-op orchestration with action discriminator
- `src/runner/agent-pack/remove.ts` — uninstall with runtime-dir archival

**Focus areas (Lightweight integration)**:
- `src/cli/commands/agent.ts` — subcommand wiring; tests via `execSync` against `dist/cli/index.js` with the FakeFetcher injected through a test-only env var (e.g., `MINIH_AGENT_PACK_FETCHER=fake`).

**Excluded**:
- Real GitHub calls in `npm test` — gated behind `MINIH_E2E=1`.
- Cross-platform tarball edge cases (Windows-specific path separators, symlinks across drives) — flagged for follow-up if reported.
- Performance benchmarking — install is one-shot; no SLA defined.

**Coverage gates**:
- All 15 acceptance criteria have at least one automated test (E2E + unit blend).
- `MINIH_REGRESSION=1` baseline regression includes new `agent` subcommand surface in `doctor`/`list` output.

## Documentation Strategy

**Approach**: Option C — Hybrid (README + docs/how/).

**Rationale**: New user-facing CLI feature with discrete surface area. README needs a quick-start hook so users discover it; `docs/how/agent-pack.md` carries the depth (security model, subpath syntax, sidecar fields, troubleshooting). Existing guides (AGENTS.md, AGENTS_README.md) get cross-references.

**Files**:

| File | Change | Audience |
|---|---|---|
| `README.md` | New "Agent Packs" section: 3-line demo + link to docs/how/ | First-time visitors |
| `docs/how/agent-pack.md` | NEW — full surface, manifest format, sidecar format, security model, error code reference (E180-E184), troubleshooting | Operators using the feature |
| `AGENTS.md` | Add a sentence to "Companion-mode is mandatory" — `minih agent install code-review-companion` is the canonical way to bring it into a fresh project | Agent authors |
| `AGENTS_README.md` | Update install/getting-started — mention `agent` subcommand alongside `init`, `run`, etc. | Agent authors |
| `docs/domains/cli/domain.md` | History row + composition entry for `commands/agent.ts` | Maintainers |
| `docs/domains/runner/domain.md` | History row + composition entry for `agent-pack/` sub-module + new contracts | Maintainers |
| `docs/domains/domain-map.md` | If needed: update the cli + runner node labels (no new edges expected) | Maintainers |

## Workshop Opportunities

The CLI shape workshop (`workshops/001-cli-shape.md`) resolved most design questions. Remaining workshop candidates for `/plan-2c-workshop` if any feel risky after clarify:

| Topic | Type | Why Workshop | Key Questions |
|---|---|---|---|
| Atomic-swap install/upgrade | Storage Design | Partial-failure recovery on upgrade is non-trivial | Temp-dir-then-rename vs copy-aside? Checksum strategy? Rollback semantics? Crash mid-swap? |
| Subpath URL syntax | API Contract | Three accepted syntaxes might confuse error messages | Which is canonical in `--help`? Which appears in `agent info`? Is one preferred over others? |
| Tar parser dependency choice | Integration Pattern | First HTTP/extract code in repo; deps are political | `tar-stream` vs hand-rolled minimal reader vs streaming through `node:zlib` only? Security boundary at extract time? |
| Manifest schema evolution | Data Model | We want ARA-future-compat without ARA-now-cost | What's the minimal `agent.json` v1 shape? Which fields are optional vs required? How to deprecate fields cleanly? |
| Registry promotion process | Integration Pattern | "Inclusion criteria" need teeth | What's the PR template for promoting an agent? Is there an automated check (e.g., CI verifies the agent installs in a clean env before merge)? |

## External Research Already Performed

- ✅ **R1 (distribution standards)** — `external-research/distribution-standards.md`. Result: adopt Claude Code Plugin Marketplace pattern.
- ⏳ **R2 (tarball-extract patterns)** — flagged in research-dossier; not yet executed. Recommend doing this before plan-3 architect.
- ⏳ **R3 (install manifest conventions)** — flagged in research-dossier; partially superseded by R1. May not need separate execution.
