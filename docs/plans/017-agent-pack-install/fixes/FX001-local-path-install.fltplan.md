# Flight Plan: Fix FX001 — Local-path install

**Fix**: [`FX001-local-path-install.md`](./FX001-local-path-install.md)
**Status**: Landed

## What → Why

**Problem**: Plan-017 Phase 1 landed the agent-pack foundations but no executable install. Users can't `minih agent install <anything>` until Phase 2/3/4 land.

**Fix**: Vertical slice — implement local-path install (`minih agent install /abs/path`) using the Phase 1 building blocks. Subsumes the local branch of plan tasks 2.1/2.2/4.1/4.2; remote/CLI surface still ships in their proper phases.

## Domain Context

| Domain | Relationship | What Changes |
|---|---|---|
| `runner` | modify | NEW `agent-pack/install.ts`; widen `AgentPackSource` to include `'local'` variant; barrel re-export |
| `cli` | modify | NEW `commands/agent.ts` (local branch only); register in `cli/index.ts` |

## Stages

- [x] **Widen types** — `AgentPackSource` discriminated union gains `'local'` variant (`src/runner/agent-pack/types.ts` — modified)
- [x] **Install orchestrator** — `installAgentPack` for local source: validate → copy → sidecar (`src/runner/agent-pack/install.ts` — new file)
- [x] **Re-exports** — barrel + `runner/index.ts` (`src/runner/agent-pack/index.ts`, `src/runner/index.ts` — modified)
- [x] **CLI subcommand** — `agent install <ref>` local branch (`src/cli/commands/agent.ts` — new file)
- [x] **CLI wiring + integration tests** — register in `cli/index.ts`; execFileSync tests (`src/cli/index.ts`, `test/cli/agent-install-local.test.ts`)

## Acceptance

- [x] `minih agent install /path/to/agent` copies manifest files + writes sidecar
- [x] Re-install no-op when content unchanged (`action: 'unchanged'`)
- [x] Re-install upgrade when content changed (`action: 'upgraded'`); runtime dirs preserved
- [x] Path traversal rejected pre-write
- [x] URL/registry inputs return E182 with "not yet available" message
- [x] `just fft` green
