# Flight Plan: Fix FX001 — TUI footer input routes to coordinated inbox

**Fix**: [FX001 dossier](./FX001-tui-input-routes-to-inbox.md)
**Status**: Ready

## What → Why

**Problem**: TUI footer typing in coordinated runs goes to the SDK conversation, bypassing the inbox completely. Silent failure — operator types, agent never sees it as a coordination message.

**Fix**: Route coordinated-run footer input through `appendInboxMessage` (the same path `outside inbox send` uses); preserve `SessionSender.send` for non-coordinated runs. Make the routing visible in the footer label.

## Domain Context

| Domain | Relationship | What Changes |
|--------|-------------|-------------|
| `cli` | Primary | `input-bridge.ts` capability + submit logic; footer label |
| `runner` | Secondary | `onSessionReady` ctx gets `coordinated`/`runDir`/`agentSlug` |
| `adapter` | None | SessionSender still used for non-coordinated path |

## Stages

- [ ] **Stage 1: Plumb ctx** — extend `AgentRunConfig.onSessionReady` ctx with coordination flag + runDir + agentSlug (`src/runner/types.ts`, `src/runner/runner.ts`)
- [ ] **Stage 2: Bridge dual-routing** — `InputBridge` capability + submit gains coordinated path (`src/cli/human/input-bridge.ts`)
- [ ] **Stage 3: Footer label** — render the new capability labels (`src/cli/human/panes/footer.tsx`)
- [ ] **Stage 4: Wire CLI** — propagate ctx in `run.ts` + `resume.ts` (`src/cli/commands/run.ts`, `src/cli/commands/resume.ts`)
- [ ] **Stage 5: Tests** — coordinated routing test + non-coordinated regression (`test/cli/human-input-bridge.test.ts`)

## Acceptance

- [ ] Coordinated run footer input → outside inbox entry (visible to `inbox_list` + `outside inbox list`)
- [ ] Non-coordinated run footer input → SessionSender (no regression)
- [ ] Footer label signals routing mode
- [ ] `just fft` green
