# Fix FX002: `minih agent info` + `agent list` — complete the local-install loop

**Created**: 2026-05-03
**Status**: Complete
**Plan**: [`../agent-pack-install-plan.md`](../agent-pack-install-plan.md)
**Source**: User direction — "okay great so what's next" → recommended `info` + `list` to complete the local-install user loop after FX001
**Domain(s)**: `cli` (modify — extend `agent` subcommand group)

---

## Problem

After FX001 shipped, users can `minih agent install /path/to/local-agent` and get a working install with sidecar, checksums, and atomic-swap upgrade. But they have **no way to introspect** what was installed — no `info`, no `list`. Phase 1 built `readSourceSidecar` / `verifyChecksums` / `listRegistryAgents` and shipped the `.minih-source.json` schema, but those have no user-visible consumer yet.

Without `info` and `list`:
- Users can't tell what version of an agent is installed
- Users can't tell what source it came from
- Users can't detect file-level drift (did I edit the prompt? did upstream change?)
- Users can't list all the minih-installed agents in their project (the existing `minih list` shows installed agents but doesn't distinguish minih-installed from hand-rolled)

## Proposed Fix

Add two read-only subcommands under `minih agent`:

1. **`minih agent info <slug>`** — full provenance + manifest + drift inspector
2. **`minih agent list`** — table with source-type column (local / url / registry / hand-rolled)

Both commands are pure read — no network, no writes. They consume Phase 1 infrastructure (`readSourceSidecar`, `verifyChecksums`, `readAgentManifest`, `listAgents`, `parseFrontmatter`) and the FX001 install metadata.

After FX002, the local-install loop is complete: `install` → `info` → `list`.

## Domain Impact

| Domain | Relationship | What Changes |
|---|---|---|
| `cli` | modify | EXTEND `src/cli/commands/agent.ts` with two new subcommands. JSON envelope on stdout, human table on stderr. No new dependencies. |
| `runner` | not involved | Already exposes everything we need from FX001 + Phase 1. No changes. |
| `adapter` | not involved | n/a |
| `mcp` | not involved | n/a |

Domain direction (`cli → runner`) preserved.

## Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|---|---|---|---|---|---|---|
| [x] | FX002-1 | Implement `minih agent info <slug>` action. Reads `.minih-source.json` (`null` if hand-rolled), reads `agent.json` if present, falls back to `prompt.md` frontmatter. Computes per-file drift via `verifyChecksums`. JSON envelope: `{slug, description, tags, coordination, source, installedAt, manifestVersion, files: [{path, description, status: 'unchanged' \| 'modified' \| 'missing'}]}`. Human stderr: formatted table with ✓/⚠️/✗ icons. Reports E121 if slug doesn't resolve to an installed folder. | cli | `src/cli/commands/agent.ts` | `minih agent info src-agent` shows provenance + drift; non-existent slug returns E121 | Per spec AC9 |
| [x] | FX002-2 | Implement `minih agent list` action under the `agent` group. Lists installed agents from `agentsDir` with source-type column (📦 local / ☁ url / 🏪 registry / 👋 hand-rolled / `?` unknown if sidecar malformed). Reads each agent's `.minih-source.json` (best-effort) to determine source type. JSON envelope: `{agents: [{slug, description, source: {type, ...} \| null, ...}], count}`. Human stderr: table sorted by slug. | cli | `src/cli/commands/agent.ts` | `minih agent list` returns table with source-type column; works on a fresh project (empty list); works after FX001 install. | Per spec AC8 |
| [x] | FX002-3 | TDD via `execFileSync`: write `test/cli/agent-info-list.test.ts` covering: (1) `info` on FX001-installed agent → provenance + drift `unchanged`; (2) `info` after editing a manifest file → drift `modified`; (3) `info` after deleting a manifest file → drift `missing`; (4) `info` on hand-rolled agent (no sidecar) → "hand-rolled" indicator; (5) `info` on non-existent slug → E121; (6) `list` empty agentsDir → empty array; (7) `list` after FX001 install → entry with source.type='local'; (8) `list` after creating a hand-rolled agent → entry with source: null; (9) JSON envelope shape on both commands. | cli | `test/cli/agent-info-list.test.ts` | All 9+ cases green | Hybrid testing per spec |

## Workshops Consumed

- [`../workshops/001-cli-shape.md`](../workshops/001-cli-shape.md) — `info` + `list` UX from workshop tables

## Acceptance

- [ ] After FX001 install, `minih agent info <slug>` shows source type, ref/path, commit/resolvedAt, install date, per-file checksum drift (with ✓/⚠️/✗ icons)
- [ ] Editing an installed file → `info` shows that file as `modified` (sidecar checksum mismatch)
- [ ] Deleting an installed file → `info` shows that file as `missing`
- [ ] `info` on a hand-rolled agent (no `.minih-source.json`) returns a useful envelope with `source: null` + an explicit "hand-rolled" indicator (not E121)
- [ ] `info` on non-existent slug returns E121 with hint
- [ ] `minih agent list` returns table; source column distinguishes minih-installed from hand-rolled
- [ ] `just fft` green
- [ ] Existing `minih list` behavior unchanged (backward compat — separate subcommand, no aliasing in this fix)

## Discoveries & Learnings

_Populated during implementation._

| Date | Task | Type | Discovery | Resolution |
|---|---|---|---|---|
