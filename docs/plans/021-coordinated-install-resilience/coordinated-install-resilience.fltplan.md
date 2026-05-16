# Flight Plan: Coordinated Install Resilience

**Spec**: [coordinated-install-resilience-spec.md](./coordinated-install-resilience-spec.md)
**Plan**: [coordinated-install-resilience-plan.md](./coordinated-install-resilience-plan.md)
**Workshop**: [workshops/001-mcp-error-watchdog-state-machine.md](./workshops/001-mcp-error-watchdog-state-machine.md) (Contract Ready — **deferred to follow-up plan**)
**Origin**: [`AI-Substrate/minih#30`](https://github.com/AI-Substrate/minih/issues/30) (downstream wedge report, 2026-05-15)
**Generated**: 2026-05-15
**Status**: **W1 + partial W2 SHIPPED** — plan-3 + FX001 + T002 + T004 landed; W3/W4/T005/T021-T023 **DEFERRED** per scope reduction 2026-05-16; awaiting follow-up plan for the watchdog + diagnostic CLI work
**Mode**: Simple (single-phase plan; clarify Q5 → one PR all workstreams — **scope reduced 2026-05-16: only W1 + partial W2 ship in this PR**)

> ⚠️ **Scope Reduction (2026-05-16)**: This flight plan was originally drafted for the full 24-task plan. Sections below (The Mission, Where We Are, Goals, Acceptance Criteria, Key Risks) still describe the full scope as reference for the follow-up plan. **Only W1 + partial W2 ship in this PR.** See § Phases Overview below for the precise shipped-vs-deferred state; see `coordinated-install-resilience-plan.md` § Scope Reduction for full detail.

---

## The Mission

**What we're building**: A four-phase fix for the canonical `code-review-companion` install wedge. We ship the missing per-agent schemas + outside contract so fresh installs work (Phase 1), close the implicit-manifest hole so future coordinated agents don't fall through the same crack (Phase 2), add a runner-level watchdog so any future MCP-error wedge terminates cleanly with `terminalReason: 'mcp_error'` instead of zombieing for ~30 minutes (Phase 3), and add the two diagnostic CLI surfaces operators needed during the live #30 investigation but had to `cat`/`grep` to get (Phase 4).

**Why it matters**: Downstream `AI-Substrate/pij` is blocked today; every other adopter who installs `code-review-companion` from `main` hits the same wedge silently. The harness IS the product — when it ships a broken canonical agent and provides no recovery signal when a run wedges, we set the worst possible example for adopters.

---

## Where We Are → Where We're Headed

```
TODAY (0.1.6):                              AFTER this plan (0.2.0):
─────────────────────────────────────       ─────────────────────────────────────
🔴 code-review-companion installs           🟢 Installs ship 7 files including
   with 4 files, no state schemas              state schemas + outside.md
🔴 'reading' state rejected at boot,        🟢 Schema enum matches prompt
   model wedges silently                       vocabulary; orient flow clean
🔴 Zombie run sits at status:"active"       🟢 Watchdog fires terminalReason:
   for ~30min until idle-budget               'mcp_error' after 60s post-isError
🔴 minih doctor warns "silently             🟡 Doctor warning rewritten:
   rejected" (misleading)                      "rejected at runtime; wedges
                                                run unless mcpErrorTimeoutMs set"
🔴 Implicit-manifest installs miss          🟢 CANONICAL_AGENT_FILES already lists
   state/ schemas (same wedge path)            inside-state.schema.json (root)
🔴 No CLI way to preview install            🟢 minih agent info <slug> --remote
   payload before committing                   shows manifest without installing
🔴 No CLI way to find wedge-relevant        🟢 minih tail --since-tool /
   turns in events.ndjson                      --around-error surface them
```

```mermaid
flowchart LR
    classDef existing fill:#E8F5E9,stroke:#4CAF50,color:#000
    classDef changed fill:#FFF3E0,stroke:#FF9800,color:#000
    classDef new fill:#E3F2FD,stroke:#2196F3,color:#000

    subgraph Current["Current (0.1.6)"]
        CA[code-review-companion<br/>agent.json: 4 files]:::existing
        CB[installAgentPack<br/>CANONICAL_AGENT_FILES list]:::existing
        CC[Runner event loop]:::existing
        CD[minih agent info]:::existing
        CE[minih tail]:::existing
        CF[minih doctor warning copy]:::existing
    end

    subgraph Target["After (0.2.0)"]
        TA[code-review-companion<br/>agent.json: 7 files]:::changed
        TB[CANONICAL_AGENT_FILES<br/>state/-prefixed paths]:::changed
        TC[Runner event loop<br/>+ MCP-error watchdog]:::changed
        TD[minih agent info<br/>+ --remote/--local/--diff]:::changed
        TE[minih tail<br/>+ --since-tool/--around-error]:::changed
        TF[minih doctor warning copy<br/>accurate language]:::changed
        TG[outside.md<br/>inside-state.schema.json<br/>outside-state.schema.json<br/><i>(root per FX001)</i>]:::new
    end

    CA --> TA
    TA --> TG
    CB --> TB
    CC --> TC
    CD --> TD
    CE --> TE
    CF --> TF
```

**Legend**: existing (green, unchanged) | changed (orange, modified) | new (blue, created)

---

## Scope

**Goals**:
- Ship the missing schemas + outside contract for `code-review-companion`; bump to `0.2.0`; verify upgrade detection
- Close the implicit-manifest hole so coordinated agents without `agent.json` also ship `state/` schemas
- Terminate zombie runs cleanly with `terminalReason: 'mcp_error'` (default-on, frontmatter opt-out)
- Stop misleading operators (doctor copy + stale schema description)
- Make the dogfood rule enforceable (`agent info --remote`, `tail --since-tool`)

**Non-Goals**:
- Diagnosing why specific models go silent after `isError` (watchdog renders this moot)
- Hardening other agents' manifests beyond `code-review-companion`
- Rewriting `src/mcp/tools/state.ts` validation logic (it's correct; the bug is the missing schema file)
- Reshaping the broader `minih agent` verb tree (only the `info` flag set is in scope)
- Changing default model, default permissions, or any other companion-mode contract

---

## Journey Map

```mermaid
flowchart LR
    classDef done fill:#4CAF50,stroke:#388E3C,color:#fff
    classDef active fill:#FFC107,stroke:#FFA000,color:#000
    classDef ready fill:#9E9E9E,stroke:#757575,color:#fff

    S[Specify]:::done --> W[Workshop<br/>watchdog state machine]:::done
    W --> C[Clarify<br/>7 Qs resolved]:::done
    C --> P[Plan]:::done
    P --> P1[Workstream 1<br/>FX003b 0.2.0]:::ready
    P1 --> P2[Workstream 2<br/>implicit-manifest<br/>+ doc/copy]:::ready
    P2 --> P3[Workstream 3<br/>MCP-error watchdog]:::ready
    P3 --> P4[Workstream 4<br/>agent info + tail filters]:::ready
    P4 --> X[Cross-cutting<br/>docs + just fft]:::ready
    X --> D[Done]:::ready
```

**Legend**: green = done | yellow = active | grey = not started

---

## Phases Overview

**Simple mode** — single phase, originally 4 workstreams + cross-cutting (**24 tasks**, T000–T023). Per 2026-05-16 scope reduction, **only W1 + partial W2 shipped in this PR**; W3, W4, T005, and cross-cutting deferred to a follow-up plan. The 6 watchdog-prep commits (T005, T007–T011) were `git reset` out of the branch; design work preserved in workshop 001 and the spec.

| Order | Workstream | Tasks | CS | Status |
|-------|------------|-------|----|--------|
| 1 | FX003b — ship 0.2.0 (unblock gate) | T000–T002 (3) | CS-1 | ✅ **Shipped** |
| 2 | Implicit-manifest + doc/copy fixes | T003 (no-op), T004 only — T005 **DEFERRED** | CS-1 → CS-0.5 | ✅ **Partial: T003 (no-op per FX001) + T004 shipped; T005 deferred** |
| 3 | MCP-error watchdog | T006–T016 (11) | CS-3 | 🚧 **DEFERRED** — reset out 2026-05-16; workshop 001 stays Contract Ready for the follow-up plan |
| 4 | Diagnostic CLI surfaces | T017–T020 (4) | CS-2 | 🚧 **DEFERRED** |
| — | Cross-cutting (docs + release gate) | T021–T023 (3) | CS-1 | 🚧 **DEFERRED** (docs page would cross-link to non-existent sections) |

**This PR ships the actual unblock-pij fix**: `code-review-companion@0.2.0` with the missing schemas at agent root + `outside.md` + upgrade detection + implicit-manifest regression test. Downstream pij can drop their workaround.

---

## Acceptance Criteria

Top-level success criteria (full list of 17 lives in the spec):

- [x] Fresh `minih agent install code-review-companion` ships `inside-state.schema.json`, `outside-state.schema.json`, `outside.md` at agent root (Phase 1 — per FX001)
- [ ] `agent.json` reports `version: '0.2.0'` with 7 files; upgrade from `0.1.0` reports the 3 new files in `changedFiles[]` (Phase 1)
- [ ] Fresh post-`0.2.0` companion run executes `state_transition({ to: 'reading' })` without wedging (Phase 1 gate)
- [ ] Implicit-manifest install picks up `state/` schemas via `CANONICAL_AGENT_FILES` (Phase 2)
- [ ] Run (coordinated or non-coordinated) silent ≥60s after `isError: true` terminates with `terminalReason: 'mcp_error'` (Workstream 3 — default-on)
- [ ] Frontmatter `mcpErrorTimeoutMs: null` at root opts an agent out of the watchdog (Workstream 3)
- [ ] `minih agent info <slug> --remote` previews remote manifest without installing (Phase 4)
- [ ] `minih tail --since-tool <name>` filters snapshot from most-recent matching tool call (Phase 4)

---

## Key Risks

| Risk | Mitigation |
|------|-----------|
| Watchdog default-on flip surprises agents that legitimately pause after errors (coordination-loop-validator, custom test agents) | Opt-out frontmatter `mcpErrorTimeoutMs: null` at root; set it on the validator + any affected test agent; regression suite covers both default-on and opt-out paths |
| `agent info --remote` may force a small fetcher refactor (read manifest without installing) | If hairy, demote `--remote` to a separate PR; Phases 1-3 are the critical path |
| `--since-tool` interaction with `--follow` mode is ambiguous | Spec assumes `--since-tool` is snapshot-only for v1; clarify Q4 logged |
| Doctor copy rewrite breaks `MINIH_REGRESSION=1` baseline | Update baseline in same commit as the copy change |

---

## Flight Log

_No phases completed yet._
