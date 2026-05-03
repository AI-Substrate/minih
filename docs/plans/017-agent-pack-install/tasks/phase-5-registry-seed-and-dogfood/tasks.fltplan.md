# Flight Plan: Phase 5 — Registry Seed + Dogfood

**Plan**: [`../../agent-pack-install-plan.md`](../../agent-pack-install-plan.md)
**Phase**: Phase 5: Registry seed + dogfood — `code-review-companion` end-to-end
**Generated**: 2026-05-03
**Status**: Ready for takeoff

---

## Departure → Destination

**Where we are**: Phase 1 + 3 + FX001 + FX002 shipped. The agent-pack module supports local install, real GitHub fetch via URL, info, list (installed), and the `--available` flag is wired but the registry catalog is empty (returns `[]`). `code-review-companion/` exists in the source repo with 4 files (`prompt.md`, `instructions.md`, `input-schema.json`, `output-schema.json`) but no `agent.json` manifest. The headline scenario `minih agent install code-review-companion` returns E180 (slug not found in registry).

**Where we're going**: A fresh-project user running `minih agent install code-review-companion` will have the canonical companion agent installed end-to-end against real GitHub. The bundled CLI ships `dist/templates/agents-registry.json` with one curated entry. `agents/code-review-companion/agent.json` becomes the canonical reference example for future agent authors. The curation principle (one-PR-at-a-time promotion; internal-only agents stay out) is enforced and regression-tested.

---

## Domain Context

### Domains We're Changing

| Domain | What Changes | Key Files |
|--------|-------------|-----------|
| `runner` (data) | NEW canonical manifest + bundled registry catalog | `agents/code-review-companion/agent.json`, `src/templates/agents-registry.json` |
| build pipeline (no domain) | Extend `copy-schemas.js` to ship the registry catalog | `scripts/copy-schemas.js` |
| `runner` (test) | Add unit + e2e tests for the bundled seed | `test/runner/agent-pack/registry-seed.test.ts`, `test/e2e/agent-pack-real-fetch.test.ts` |
| `cli` (test) | Add `MINIH_REGRESSION` baseline test | `test/cli/agent-list-baseline.test.ts` |
| `docs` | History rows + plan progress | `docs/domains/runner/domain.md`, `docs/domains/cli/domain.md`, `docs/plans/017-agent-pack-install/agent-pack-install-plan.md` |

### Domains We Depend On (no changes)

| Domain | What We Consume | Contract |
|--------|----------------|----------|
| `runner` (`agent-pack/registry.ts`) | Registry parsing + slug resolution | `readRegistryCatalog(path?)`, `resolveRegistrySlug(slug, catalog)`, `listRegistryAgents(catalog)` |
| `runner` (`agent-pack/manifest.ts`) | Manifest validation | `validateManifest(manifest)` |
| `runner` (`agent-pack/install.ts`) | Install orchestration with `source.type: 'registry'` | `installAgentPack({source: {type: 'registry', registrySlug, ...}, fetcher})` |
| `runner` (`agent-pack/fetcher.ts`) | Real GitHub tarball fetcher | `GitHubAgentPackFetcher.fetchTarball(url, ref)` |
| `cli` (`commands/agent.ts`) | Subcommand surface | `agent install`, `agent list --available`, `agent info <slug>` |

---

## Flight Status

<!-- Updated by /plan-6-v2: pending → active → done. Use blocked for problems/input needed. -->

```mermaid
stateDiagram-v2
    classDef pending fill:#9E9E9E,stroke:#757575,color:#fff
    classDef active fill:#FFC107,stroke:#FFA000,color:#000
    classDef done fill:#4CAF50,stroke:#388E3C,color:#fff
    classDef blocked fill:#F44336,stroke:#D32F2F,color:#fff

    state "1: Audit prompt portability" as S1
    state "2: Author agent.json" as S2
    state "2b: TDD manifest validation" as S2b
    state "3: Verify local round-trip" as S3
    state "4: Author registry seed" as S4
    state "5: Wire build pipeline" as S5
    state "6: Verify build artifact" as S6
    state "7: Unit test slug resolves" as S7
    state "8: MINIH_E2E headline" as S8
    state "9: MINIH_REGRESSION baseline" as S9
    state "9b: Self-install regression" as S9b
    state "10: Domain docs + plan progress" as S10
    state "11: Post-merge follow-up" as S11

    [*] --> S1
    S1 --> S2
    S2 --> S2b
    S2b --> S3
    S3 --> S4
    S2 --> S4
    S4 --> S5
    S4 --> S9
    S5 --> S6
    S6 --> S7
    S7 --> S8
    S8 --> S10
    S9 --> S10
    S9 --> S9b
    S9b --> S10
    S10 --> S11
    S11 --> [*]

    class S1,S2,S2b,S3,S4,S5,S6,S7,S8,S9,S9b,S10,S11 pending
```

**Legend**: grey = pending | yellow = active | red = blocked/needs input | green = done

---

## Stages

<!-- Updated by /plan-6-v2 during implementation: [ ] → [~] → [x] -->

- [x] **Stage 1: Audit prompt portability** — Sweep `prompt.md` + `instructions.md` for minih-internal paths (`agents/code-review-companion/prompt.md`, `agents/code-review-companion/instructions.md`)
- [~] **Stage 2: Author agent.json** — The canonical reference manifest with 4 files (`agents/code-review-companion/agent.json` — new file)
- [ ] **Stage 2b: TDD manifest validation** — Unit test runs `validateManifest()` against the canonical file (`test/runner/agent-pack/companion-manifest.test.ts` — new file)
- [ ] **Stage 3: Verify local install round-trip** — Manual smoke against built CLI (no new files; recorded in `execution.log.md`)
- [ ] **Stage 4: Author registry seed** — One curated entry, internal-only agents stay out (`src/templates/agents-registry.json` — new file)
- [ ] **Stage 5: Wire build pipeline** — Extend `copy-schemas.js` to ship the registry to `dist/templates/` (`scripts/copy-schemas.js`)
- [ ] **Stage 6: Verify build artifact** — Confirm `dist/templates/agents-registry.json` exists; `agent list --available` returns the seed (no new files)
- [ ] **Stage 7: Unit test slug resolves** — Vitest test reads source registry directly + resolves dogfood slug (`test/runner/agent-pack/registry-seed.test.ts` — new file)
- [ ] **Stage 8: MINIH_E2E headline** — Real GitHub install in tmp project; URL form pre-merge, slug form post-merge (`test/e2e/agent-pack-real-fetch.test.ts` — extend existing)
- [ ] **Stage 9: MINIH_REGRESSION baseline + duplicate-slug guard** — Snapshot of `agent list --available` output + dedup assertion (`test/cli/agent-list-baseline.test.ts` — new file)
- [ ] **Stage 9b: Self-install regression** — Verify `agent install code-review-companion` from inside the minih repo refuses (`test/cli/agent-install-self-protect.test.ts` — new file)
- [ ] **Stage 10: Domain docs + plan progress** — History rows + Phase Index ✅ + plan-level Flight Log entry (`docs/domains/runner/domain.md`, `docs/domains/cli/domain.md`, `docs/plans/017-agent-pack-install/agent-pack-install-plan.md`, `docs/plans/017-agent-pack-install/agent-pack-install.fltplan.md`)
- [ ] **Stage 11: Post-merge follow-up registration** — FX003 stub for `MINIH_E2E_PREMERGE` flip + `outside.md` authoring (followup tracker)

---

## Architecture: Before & After

```mermaid
flowchart LR
    classDef existing fill:#E8F5E9,stroke:#4CAF50,color:#000
    classDef changed fill:#FFF3E0,stroke:#FF9800,color:#000
    classDef new fill:#E3F2FD,stroke:#2196F3,color:#000

    subgraph Before["Before Phase 5"]
        B1["src/runner/agent-pack/registry.ts"]:::existing
        B2["src/templates/<br/>shared-preamble.md<br/>retros-readme.md"]:::existing
        B3["agents/code-review-companion/<br/>prompt.md, instructions.md,<br/>schemas (no agent.json)"]:::existing
        B4["dist/templates/<br/>(no registry)"]:::existing
        B5["minih agent install crc<br/>→ E180 (slug not found)"]:::existing
        B1 -.reads (empty).-> B4
    end

    subgraph After["After Phase 5"]
        A1["src/runner/agent-pack/registry.ts"]:::existing
        A2["src/templates/<br/>shared-preamble.md<br/>retros-readme.md<br/>agents-registry.json"]:::changed
        A3["agents/code-review-companion/<br/>+ agent.json (4 files listed)"]:::changed
        A4["dist/templates/<br/>+ agents-registry.json"]:::changed
        A5["scripts/copy-schemas.js"]:::changed
        A6["minih agent install crc<br/>→ resolves → fetch → install ✅"]:::new
        A1 -.reads.-> A4
        A5 -.copies.-> A4
        A2 -.source-of.-> A4
    end
```

**Legend**: existing (green, unchanged) | changed (orange, modified) | new (blue, created)

---

## Acceptance Criteria

- [ ] `agents/code-review-companion/agent.json` exists, validates via `validateManifest()`, lists exactly 4 files
- [ ] `src/templates/agents-registry.json` exists with exactly 1 entry (`code-review-companion`)
- [ ] After `npm run build`, `dist/templates/agents-registry.json` exists and matches source byte-for-byte
- [ ] `<built-cli> agent list --available` (no `MINIH_E2E` needed) returns the seed entry
- [ ] T003 manual local-install round-trip: `install → info → re-install no-op` works
- [ ] T007 unit test green: registry parses + slug resolves
- [ ] T008 MINIH_E2E test green (URL-form pre-merge OR slug-form post-merge)
- [ ] T009 `MINIH_REGRESSION=1 npm test` green; baseline matches seed
- [ ] Spec ACs verified at least once: AC1 (headline install), AC8 (list installed vs available), AC12 (curation enforced — internal agents return E180)
- [ ] `just fft` green
- [ ] No internal-only agents leaked into the registry (`smoke-test`, `convention-check`, etc. stay out)

## Goals & Non-Goals

**Goals**:
- One-command headline install works for `code-review-companion` in any fresh project
- Registry curation is exercised end-to-end and regression-tested
- The dogfood agent's `agent.json` is the canonical reference example
- Internal-only agents stay out of the bundled registry

**Non-Goals**:
- Authoring `outside.md` + 2 state schemas for the companion (deferred to FX003 followup)
- Promoting any other agent into the registry (one-at-a-time PR process)
- Phase 4 remainder (`agent remove` confirmation, `--check`/`--check-remote` flags)
- Phase 6 docs (`docs/how/agent-pack.md`, README "Agent Packs" section)

---

## Checklist

- [x] T001: Audit prompt + instructions for fresh-project portability
- [~] T002: Author `agents/code-review-companion/agent.json`
- [ ] T002b: TDD `validateManifest()` unit test for the canonical manifest
- [ ] T003: Verify FX001 local install round-trip against the new manifest
- [ ] T004: Create `src/templates/agents-registry.json` with 1 curated entry
- [ ] T005: Extend `scripts/copy-schemas.js` to copy registry to `dist/templates/`
- [ ] T006: Verify `npm run build` produces the bundled registry artifact
- [ ] T007: Add unit test that registry parses + slug resolves
- [ ] T008: MINIH_E2E gated headline e2e (URL-form pre-merge / slug-form post-merge) with timing budget
- [ ] T009: MINIH_REGRESSION-gated baseline + duplicate-slug guard
- [ ] T009b: Self-install regression (Spec AC11 coverage)
- [ ] T010: domain.md + plan progress + plan-level Flight Log entry
- [ ] T011: Post-merge follow-up registration (MINIH_E2E_PREMERGE flip + outside.md authoring)
