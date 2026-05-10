# Message Reply Chains

**Mode**: Simple

📚 This specification incorporates findings from `research-dossier.md`.

## Research Context

The dossier (2026-04-29) found that message reply chaining is **already 90% built**. The `ackOf` field exists end-to-end in the schema, types, MCP `inbox_send` tool, JSONL storage, inbox-forwarder, human-view, and outside CLI. What's missing is:

1. The outside CLI rejects `--ack-of` unless `--type ack` (single biggest blocker).
2. The forwarder labels parent ids as "Acknowledges:" — biased toward ack semantics.
3. Agents are never told reply chains are possible (no preamble or AGENTS_README mention).

This spec proposes the smallest change that turns the existing ack-only correlation into a general "reply to a particular message" capability, then lets chains emerge naturally because each reply's id is itself a valid parent for the next reply.

## Summary

Let agents (and outside operators) reply to a specific inbox message by setting a parent message id on any new message. Replies form chains because the reply itself can be replied to. **No threads, no thread state, no enforcement** — just a single optional parent pointer per message, rendered legibly in the next agent's prompt.

## Goals

- An inside agent can send any-typed message (`note`, `question`, `task`, `review`, …) carrying a pointer to a specific prior message.
- An outside operator can do the same via `outside inbox send --ack-of <id>` regardless of `--type`.
- The receiving agent sees "In reply to: \<id\>" in its prompt for non-ack messages, and "Acknowledges: \<id\>" for `type=ack` messages (preserves today's ack semantics).
- Agents are explicitly told this exists in the shared preamble, so the capability is discoverable, not hidden.
- Chains form naturally — reply N's id becomes the parent of reply N+1 with zero new infrastructure.
- Zero on-disk format changes; all existing inbox JSONL files keep working unchanged.
- Backwards compatible — existing `inbox_ack` flows and existing CLI scripts continue to work.

## Non-Goals

- No `inReplyTo` / `parentId` rename. The field stays named `ackOf` to avoid a schema break and avoid two parallel pointers. (Workshop-deferred WO-01 in dossier.)
- No threads, thread roots, thread ids, or thread state.
- No enforcement of `ackOf` referent existence — minih remains the messenger, not the police (PL-01).
- No change to `unread` semantics. A non-ack reply does NOT mark its parent read; only `inbox_ack` (or any ack-typed message with `ackOf`) does. This preserves plan 012's peer-activity verdict ladder.
- No change to peer-activity / doctor's `lastAckOf` derivation.
- No new human-view rendering work in this plan. Existing `ackOf`-aware rendering is good enough; visual polish can be a follow-up.
- No reply concept on the state side. State writes are not messages.
- No retroactive validation of historical messages.

## Target Domains

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| runner | existing | **modify** | Switch inbox-forwarder render label from "Acknowledges:" to "In reply to:" when `type !== 'ack'`. Update preamble to teach agents the capability. |
| cli | existing | **modify** | Remove the `outside inbox send` gate that rejects `--ack-of` for non-ack types. Keep the inverse check (`type=ack` requires `--ack-of`). |
| mcp | existing | **modify** | Update only the `inbox_send` tool description text in `mcp/types.ts` so agents reading the tool list discover that `ackOf` is for general replies, not ack-only. |

No new domain. No new contracts. No domain registry changes.

## Complexity

- **Score**: CS-1 (trivial)
- **Breakdown**: S=1, I=0, D=0, N=0, F=0, T=1 → P=2 → CS-1
- **Confidence**: 0.95
- **Assumptions**:
  - The dossier's read of the codebase is correct: MCP-side already supports `ackOf` for any `type`; only the outside CLI gates it.
  - No external consumer parses the inbox JSONL outside this codebase.
  - "In reply to:" label change does not break any existing test that snapshots prompt text.
- **Dependencies**: none.
- **Risks**:
  - Snapshot-style tests that inline-match the literal string "Acknowledges: …" may need updating (low — easy to fix).
  - Possible `lastAckOf`-shaped logic elsewhere that conflates `ackOf-present` with `ack-typed`; dossier says no, but verify during implementation.
- **Phases**: single implementation phase covering CLI gate + forwarder label + preamble + AGENTS_README + tests + domain history rows.

## Acceptance Criteria

1. `outside inbox send <slug> --type note --subject ... --body ... --ack-of <id>` succeeds; the appended message's `ackOf` field equals `<id>`. (CLI gate removal.)
2. `outside inbox send <slug> --type ack --subject ... --body ...` (no `--ack-of`) still fails with the existing invalid-args envelope. (Inverse check preserved.)
3. `outside inbox send <slug> --type ack --subject ... --body ... --ack-of <id>` continues to succeed and produces an ack-typed message. (No regression.)
4. An inside agent calling `inbox_send({ type: 'note', subject, body, ackOf: '<id>' })` produces a stored message with `ackOf` populated. (Already works today; locked in by a positive test.)
5. When the inbox-forwarder renders a non-ack message that carries `ackOf`, the agent's prompt contains the line `In reply to: <id>` (not "Acknowledges:").
6. When the inbox-forwarder renders an ack-typed message that carries `ackOf`, the agent's prompt continues to contain `Acknowledges: <id>`.
7. The shared preamble (`agents/_shared/preamble.md` and `src/templates/shared-preamble.md`) tells coordinated agents that any `inbox_send` may include `ackOf` to reply to a specific message, and that replies can themselves be replied to.
8. `AGENTS_README.md` documents reply chains in one short subsection under coordination, with a worked example showing a 3-message chain.
9. The `inbox_send` MCP tool description (`src/mcp/types.ts`) reads in plain language that `ackOf` is the id of the message this is a reply to, mentioning `inbox_ack` as the preferred tool for explicit acknowledgements.
10. `inbox_ack` continues to behave exactly as before (idempotent, synthesises `type='ack'` with `ackOf` set, returns existing ack on duplicate).
11. Plan 012's `peer-activity` `lastAckOf` derivation still measures only `type='ack'` messages — non-ack replies do NOT count as acknowledgements for peer health.
12. The `unread` filter in `inbox_list` / `outside inbox list --unread` is unchanged: a non-ack reply does NOT remove its parent from the unread set.
13. JSONL inbox files written before this change continue to load and render correctly.
14. `just fft` passes (lint, format, build, typecheck, tests, audit).
15. Domain history rows are added to `docs/domains/{runner,cli,mcp}/domain.md` referencing plan 013.

## Risks & Assumptions

- **Risk**: agents abuse `ackOf` to chain into nonsense (point at random ids). Mitigation: none — by design, minih is messenger not police; the receiving agent will see a stale id and surface it themselves. (PL-01.)
- **Risk**: "In reply to:" label confuses agents who interpret it as "I must respond to this." Mitigation: preamble copy explicitly explains it as "the message this is a reply to," not a directive.
- **Risk**: snapshot test breakage from the label switch. Mitigation: grep `Acknowledges:` in `test/` and update affected snapshots (acceptance test #5 above is the positive test).
- **Risk**: name `ackOf` continues to misread. Mitigation: documented in spec as a known sub-optimal name; rename deferred (WO-01) until/unless it bites.
- **Assumption**: existing tests cover the gate that's being removed; flipping the negative test to a positive test is straightforward.

## Open Questions

None — see Clarifications.

## Clarifications

### Session 2026-04-29

- **Q**: When the inbox-forwarder renders a non-ack reply, what should the parent-pointer line look like in the agent's prompt? **A**: Option A — `In reply to: <id>` (id only). Minimal, matches existing style, parent message is already in agent context.
- **Mode**: Pre-set to Simple via `--simple`-equivalent declaration in spec; no Q1 needed.
- **Testing Strategy**: Defaults to Lightweight per Simple Mode + CS-1. Captured as `## Testing Strategy` below.
- **Mock Usage**: Project default — Avoid mocks (use `FakeAgentAdapter` and tmpdir fixtures, never real-SDK or filesystem mocks).
- **Documentation Strategy**: Hybrid (README + preamble) — already enumerated in Goals/ACs (AGENTS_README + shared preamble × 2 + domain history × 3).
- **Domain Review**: Confirmed — three existing domains (runner, cli, mcp); no new domains; no contract changes; only behavioural change is widening one CLI-input gate (purely permissive — no breaking change).
- **Harness Readiness**: Existing minih harness sufficient; no harness work required.

## Testing Strategy

**Approach**: Lightweight (per Simple Mode + CS-1).

**Rationale**: The change is one CLI gate removal, one render-label switch, three doc edits. Behavioural surface is narrow and easy to cover with focused unit + integration tests; full TDD overhead is not warranted.

**Focus Areas**:
- Positive test: `outside inbox send --type note --ack-of <id>` succeeds; stored message has `ackOf` populated. (CLI gate removal.)
- Negative test (preserved): `outside inbox send --type ack` (no `--ack-of`) still fails. (Inverse check.)
- Render test: `renderInboxMessageForAgent` produces "In reply to:" for non-ack messages with `ackOf`, and "Acknowledges:" for ack-typed messages with `ackOf`.
- MCP test: `inbox_send({ type: 'note', ackOf: '<id>' })` round-trips correctly through the JSONL store and reads back with `ackOf` set.
- No-regression sweep: grep `Acknowledges:` in `test/` for snapshot-style assertions and update them.
- No-regression behavioural: `unread` filter still ack-only; `inbox_ack` still idempotent; `lastAckOf` still ack-only.

**Excluded**:
- No e2e ping-pong test (the chain-formation property is implicit — each reply's id is a normal id, no special casing).
- No performance tests (no perf-relevant code path touched).
- No mocks; real fs + tmpdir + `FakeAgentAdapter`.

## Workshop Opportunities

| Topic | Type | Why Workshop | Key Questions |
|-------|------|--------------|---------------|
| _(none)_ | — | The dossier evaluated three possible workshops (rename, broaden-unread, human-view-treatment) and rejected all three. The design space is small and the project philosophy ("simple, easy, not the police") self-eliminates the alternatives. Spec → clarify → plan → implement is the right path. | — |

---

**Next steps:**
- Run `/plan-2-v2-clarify` for ≤8 high-impact questions before architecture, OR
- Skip clarification and go straight to `/plan-3-v2-architect` if confident — the surface is tiny.
