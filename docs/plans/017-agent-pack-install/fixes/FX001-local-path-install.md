# Fix FX001: Local-path install — vertical slice of `minih agent install`

**Created**: 2026-05-03
**Status**: Complete
**Plan**: [`../agent-pack-install-plan.md`](../agent-pack-install-plan.md)
**Source**: User proposal — *"what about we upgrade the command to give a local file path"*. Goal: get a working `minih agent install` end-to-end without waiting for Phase 3 (real fetch).
**Domain(s)**: `runner` (modify — install orchestration), `cli` (modify — add `agent install` subcommand, local branch only)

---

## Problem

After plan-017 Phase 1 landed, the agent-pack module has all the read-only foundations (manifest validator, registry reader, source sidecar, URL parser, fetcher injection seam) but **no executable install path** — there's no orchestration layer and no CLI command. Users can't actually `minih agent install <anything>` yet.

The full Phase 2 (FakeFetcher orchestration) + Phase 3 (real GitHub fetch) + Phase 4 (full CLI surface) progression is the right plan, but it leaves a gap: the user can't validate the install model end-to-end until 3 phases land.

A **local file path install** is a small vertical slice that:
- Exercises the full install state machine (validate manifest → copy files → write sidecar → action discriminator → upgrade detection via checksum diff)
- Doesn't need the tarball fetcher (Phase 3.2) or extractor (Phase 3.3)
- Lets users / the dogfooding loop validate the design **today**
- Is purely additive — Phase 2's full FakeFetcher tests still get written; Phase 3's real fetch still lands; Phase 4's full CLI surface (`info`, `list`, `remove`, confirmation prompts, etc.) still ships

## Proposed Fix

Implement the **local source branch** of `installAgentPack` and a thin `minih agent install <path>` CLI command. Leave registry/git URL branches as `E126`-class "not yet implemented; see Phase 3/4" stubs that compile but throw clearly.

After FX001 lands, the user can:
```bash
minih agent install /path/to/some/agent-folder
# Reads agent.json (or synthesizes implicit manifest)
# Copies all manifest-listed files to <agentsDir>/<slug>/
# Writes .minih-source.json with source.type: 'local'
# Re-running detects content drift via checksum and re-copies (idempotent)
```

This subsumes part of plan task 2.1 + 2.2 + 4.1 + 4.2 — those tasks remain in the plan but their local-path slice is delivered early. Phase 2 implementation will extend `installAgentPack` with the FakeFetcher branch (passing `fetcher: IAgentPackFetcher`); Phase 3 fills in the real fetcher; Phase 4 extends the CLI with `info`/`list`/`remove`/full flag set.

## Domain Impact

| Domain | Relationship | What Changes |
|---|---|---|
| `runner` | modify | NEW `src/runner/agent-pack/install.ts`. EXTEND `runner/index.ts` re-export. EXTEND `agent-pack/index.ts` barrel. Possible `types.ts` widening — `AgentPackSource.type` gains `'local'` variant (forward-compatible — only adds a discriminator value). |
| `cli` | modify | NEW `src/cli/commands/agent.ts`. EXTEND `src/cli/index.ts` to register the new command group. JSON envelope for action discriminator. |
| `adapter` | not involved | n/a |
| `mcp` | not involved | n/a |

Domain direction (`cli → runner`) preserved. No new domains.

## Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|---|---|---|---|---|---|---|
| [x] | FX001-1 | Widen `AgentPackSource` to include `'local'` variant: discriminated union with `{type: 'local'; localPath: string; resolvedAt: string}` (no `ref`/`commitSha` — those are remote-only). Existing `'registry'` and `'url'` variants unchanged. Update `MinihSourceSidecar.source` typing accordingly. | runner | `src/runner/agent-pack/types.ts` | TS compiles; existing tests for registry/url shape unaffected | Forward-compat: future variants can add new types without breaking |
| [x] | FX001-2 | TDD: write `test/runner/agent-pack/install.test.ts` covering: (1) fresh local install with explicit `agent.json`; (2) fresh install with implicit manifest (no agent.json in source); (3) re-install identical source → `action: 'unchanged'`; (4) re-install changed source → `action: 'upgraded'` with checksum diff; (5) preserve `runs/`/`inbox/`/`state/` on upgrade; (6) self-install refusal (source path === target path); (7) E183 collision (folder exists locally without `.minih-source.json`); (8) `--as <new-slug>` aliasing; (9) `--force` overrides E183; (10) source manifest with path-traversal entry → reject before any write. THEN implement `src/runner/agent-pack/install.ts` exporting `installAgentPack(opts: InstallOptions): Promise<InstallResult>`. | runner | `src/runner/agent-pack/install.ts`, `test/runner/agent-pack/install.test.ts` | All 10+ tests green; idempotent; preserves runtime dirs; honors `--as`/`--force` | Plan task 2.1+2.2 vertical slice |
| [x] | FX001-3 | Wire `installAgentPack` and the new types via `src/runner/agent-pack/index.ts` barrel + `src/runner/index.ts` re-exports | runner | `src/runner/agent-pack/index.ts`, `src/runner/index.ts` | `import { installAgentPack } from '../../runner/index.js'` works in CLI tests | Composition prep |
| [x] | FX001-4 | Implement `src/cli/commands/agent.ts` with `agent install <ref>` subcommand. For now, only the local-path branch is wired — registry/URL inputs return E182 with "not yet available; see Phase 3/4" message. JSON envelope on stdout with `action: 'installed' \| 'upgraded' \| 'unchanged'`; human table on stderr. Honors global `--agents-dir`. Flags: `--as <slug>`, `--force`, `--yes`. | cli | `src/cli/commands/agent.ts` | `minih agent install /path/to/test-agent` works against built CLI; envelope shape correct | Plan task 4.1+4.2 vertical slice (local branch only) |
| [x] | FX001-5 | Wire `registerAgentCommand(program)` into `src/cli/index.ts`. Write `test/cli/agent-install-local.test.ts` — `execFileSync` against the built CLI for: (1) local install (explicit `agent.json`); (2) re-install no-op; (3) re-install upgrade after edits; (4) URL form returns E182 with helpful message; (5) `--as <new-slug>` aliasing. | cli | `src/cli/index.ts`, `test/cli/agent-install-local.test.ts` | All 5 CLI integration tests green; `npm run build` then `node dist/cli/index.js agent install --help` shows the command | Cross-domain composition |

## Workshops Consumed

- [`../workshops/001-cli-shape.md`](../workshops/001-cli-shape.md) — verb table + flag set + JSON envelope shape

## Acceptance

- [ ] In a fresh test project (or a `mktemp -d`), `minih agent install /path/to/local/agent-folder` copies the manifest-listed files and writes `.minih-source.json` with `source.type: 'local'`
- [ ] Re-running on identical source reports `action: 'unchanged'` and modifies nothing
- [ ] Re-running after editing the source reports `action: 'upgraded'` and atomic-swaps the changed files; runtime dirs (`runs/`/`inbox/`/`state/`) preserved
- [ ] Path traversal in any manifest path is rejected before any disk write
- [ ] Self-install (source path === target path) is refused with `--as` hint
- [ ] URL/registry inputs return E182 with a clear "not yet available; see Phase 3/4" message — they don't crash
- [ ] `just fft` green
- [ ] No imports from `cli/` or `mcp/` into `runner/agent-pack/` (domain direction holds)

## Discoveries & Learnings

_Populated during implementation._

| Date | Task | Type | Discovery | Resolution |
|---|---|---|---|---|
