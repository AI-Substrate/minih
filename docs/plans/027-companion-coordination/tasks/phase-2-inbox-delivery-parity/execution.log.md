# Phase 2 — Inbox delivery parity (#40) · Execution Log

**Plan**: companion-coordination · **Phase**: 2 (CS-3) · **Mode**: Full (Full TDD) · **Companion**: `code-review-companion` (`--companion`)
**Started**: 2026-06-15

---

## Harness seam — pre-implement (T000)

`/eng-harness-flow --event pre-implement --phase "Phase 2: Inbox delivery parity (#40)" --plan-dir docs/plans/027-companion-coordination --json`

- **Router decision**: `route` → `eng-harness-1-boot --validate` (engineering-dispatch boot step).
- **`harness doctor`**: `status: ok` — all 5 layers green (toolchain, cli-build [consumer install → dev build n/a], extensions [1 loaded], instructions, record-types). Branch `027-companion-coordination`.
- **`harness boot`**: **`status: degraded`** — lint **pass** (clean), typecheck `tsc --noEmit` **pass** (clean), build+test `just check` **pass** (clean); minih-doctor **warn** (pre-existing warnings), audit **warn** (1 critical / 6 high npm-audit, pre-existing). `next_action`: "Ready to work, with caveats."
- **Verdict** (narration vocab): degraded ≈ **proceed-with-note**. The three code-quality sensors gating this TDD work (lint / typecheck / build+test) are clean; the two warns are the known minih-doctor + npm-audit baseline (same as Phase 1 — honest, not broken). **Proceeded.**

## Companion — boot (C0)

- No active `code-review-companion` run (prior run `2026-06-15T07-39-33-328Z-5100` was `completed`, not active). Booted a fresh one via `minih run code-review-companion` (GH_TOKEN exported from `gh auth token`).
- Run id: `2026-06-15T09-22-20-918Z-e4d5` (verified `verdict: active`). Briefing delivered (`messageId 01KV474DKGYCHBGKY591EPP3T8`).

---

## Commit strategy (decision)

TDD-faithful with green commits. The core #40 fix touches an export (T002), the event-wait branch (T003), and the RED proof (T001). To keep every commit green **and** give the companion focused diffs:

1. **C1 = T002** — isolated additive refactor (`listUnackedVisible` export). Green standalone.
2. **C2 = T001 + T003** — the #40 behaviour fix. T001's RED is captured *before* T003 (event-wait untouched by T002, so it still fails for the documented reason); T003 turns it green; committed together so the commit is green.
3. **C3 = T004** · **C4 = T005** · **C5 = T006** — parity / wildcard+loop / cleanup-guard, each green.

Deviation logged per Phase 1 pattern E (placement honesty): T002's code lands before T001's test is written, but the RED-for-the-right-reason proof is preserved (run + captured before T003).

---

## Tasks

### T002 — export `listUnackedVisible` (contract change, additive) ✅

- Extracted `inbox-poll.ts`'s private `listVisible` into an exported `listUnackedVisible(location, readLane, options, peerLane?, limit?)`.
  - `peerLane` defaults to `readLane==='outside' ? 'inside' : 'outside'` (the ack-record lane); `limit` defaults to `normalizeLimit(options.limit)`.
  - New `ListFilterOptions` interface (type/waitForAny/unread/after/limit) — the filter fields the helper actually reads; `PollInboxOptions extends ListFilterOptions` adds the wait/cap/watch fields. So `event-wait` can call the helper without knowing about `maxWaitMs`.
  - Doc-comment scoped to its real consumers (`pollInboxLane` + `event-wait`); explicitly NOT for ledger/drain consumers (they derive over raw `folder.ts` lanes).
- Re-pointed `pollInboxLane`'s 3 internal call sites (`:114`, and both `waitForMatching` branches) at the new export. Filter-chain order (unread → type → waitForAny → after) moved verbatim — byte-unchanged.
- **Evidence**: `npx tsc --noEmit` clean; `npx vitest run test/runner/inbox-poll.test.ts` → **12/12 pass** (regression guard green — `pollInboxLane` signature + behaviour unchanged).
- AC: prerequisite for AC-3/4/5 (the one consumed model). Contract change noted for Phase 6 domain.md reconciliation.

| Date | Task | Type | Discovery | Resolution | References |
|------|------|------|-----------|------------|------------|
| 2026-06-15 | T002 | decision | Commit order: land T002 (refactor) first, then T001+T003 (the #40 fix) — keeps every commit green while preserving TDD RED-before-GREEN (event-wait untouched by T002, so T001 still fails for the documented reason). | Logged per Phase 1 pattern E (placement honesty). | tasks.md § Commit strategy |

### T001 — RED regression (AC-3) ✅

Added a `describe('waitForAny — #40 inbox delivery parity (Phase 2)')` block to `test/runner/event-wait.test.ts`:
- **positive** — a peer message queued BEFORE the wait (no later fire) is returned by the immediate pass; asserts id + **body** + type (not just a count). Also asserts `totalWatchers===0` / `closeCalls===0` (the immediate settle armed nothing — V-2).
- **negative guard (V-4)** — a pre-queued *non-matching* type with a `{types:['question']}` filter is NOT returned; falls through to a clean timeout.
- **corrupt-lane (V-1)** — a torn outside lane at entry rejects with `EventWaitInboxCorruptError`, and `totalWatchers===0` (threw before registration).
- **RED evidence** (against unfixed `event-wait.ts`): positive test failed at `result.wait.matched` (`expected true, got false`) — no immediate pass + snapshot suppression. Red for the right reason. (The corrupt-lane test was also red — current `snapshotInboxIds` swallows corruption and resolves instead of rejecting.)

### T003 — rewrite the inbox.message branch onto the unread/ack model ✅

`src/runner/event-wait.ts`:
- **(a) immediate pass** — `collectImmediateInbox(opts)` runs at entry, returns already-queued unacked matches (mirrors `pollInboxLane`'s immediate read); settles `matched:true` if any.
- **(b) watcher re-reads UNACKED** — the inbox.message watcher now calls `readUnackedPeer` (→ `listUnackedVisible(peer, {unread:true, waitForAny})`) instead of an entry id-snapshot. Delivery is now identical to `inbox_list`; a pre-acked message never re-wakes.
- **(c) entry-snapshot deleted for inbox** — `snapshotInboxIds` removed; the dead `readLaneSafe`/`isInboxMessage` parsers removed (the inbox-poll parser is now the single source of truth via `listUnackedVisible`). `state.*` snapshots untouched.
- **(d) short-circuit before registration (V-2)** — the immediate pass `return`s before any watcher/timeout is armed; proven by `totalWatchers===0` on the immediate-settle path.
- **(e) corrupt-lane → typed error (V-1)** — `readUnackedPeer` maps `InboxPollError('INBOX_POLL_CORRUPT')` → `EventWaitInboxCorruptError`; no swallow-to-empty.
- **state.* untouched** — the `state.self.changed` self-write-filter test (AC-13, the named regression anchor) + AC-16 pre-existing-state stay green.
- **Evidence**: `npx tsc --noEmit` clean; `vitest` over event-wait + inbox-poll + wait-for-any-fs + tools-wait → **49/49 pass** (event-wait 20 incl. the 3 new #40 tests; inbox-poll 12; fs 2; tools-wait 15). No `wait.ts` change needed — `parseInboxFilter` already yields the wildcard (`filterTypes=null`).

| Date | Task | Type | Discovery | Resolution | References |
|------|------|------|-----------|------------|------------|
| 2026-06-15 | T003 | insight | inbox-poll's lane parser is *stricter* than event-wait's old `readLaneSafe` (it also checks `sender===lane`, ts validity, ackOf/meta). Routing event-wait's read through `listUnackedVisible` adopts that strictness — safe because real peer-lane messages carry the matching `sender`, and the existing suite seeds them correctly. | Verified all existing inbox tests stay green; the one bad-sender artifact (AC-14, inside lane) is never read on the peer-lane path. | event-wait.ts, inbox-poll.ts |
| 2026-06-15 | T003 | decision | Single-settle makes the old per-window "seen id" dedup set unnecessary — the first non-empty watcher read settles and tears down, so duplicate mtime ticks can't double-deliver. | Dropped the dedup set with the snapshot; relies on the `settled` guard. | event-wait.ts |

### T004 — parity pin (AC-4) ✅

Added `describe('waitForAny ↔ inbox_list unacked parity (#40 AC-4)')` to `event-wait.test.ts`:
- **no filter** — seed 3 outside messages, ack one via an inside `ack`/`ackOf` record; assert `waitForAny`'s inbox set == `pollInboxLane('outside', {unread:true})`'s set == `{m2,m3}`.
- **type filter** — `{types:['question']}` ⇒ `waitForAny` set == `pollInboxLane('outside', {unread:true, waitForAny:['question']})` == `{q1,q2}`.
- **Cap pinned (V-3)** — seeds are below the default `limit` (50) so both surfaces return the full set; the assertion compares full sets, not truncations, so a future `limit` change can't silently drift parity.
- Parity is structural (both call the shared `listUnackedVisible`); this test pins it so an edit to one surface can't diverge from the other. **Green** (5 matched / pass).

### T005 — loop + wildcard (AC-5) ✅

- **loop** (`event-wait.test.ts`) — m1 queued + unacked is delivered on wait 1, **re-delivered** on wait 2 (durable unread — a read doesn't consume it), then an inside `ack`/`ackOf` record between waits suppresses re-delivery on wait 3 → clean timeout.
- **wildcard, runner** (`event-wait.test.ts`) — a no-filter wait wakes on `a-type-never-seen-before` (append + fire).
- **wildcard, MCP** (`tools-wait.test.ts`) — `waitForAnyTool` with `events:[{kind:'inbox.message'}]` (no filter) wakes on a pre-queued `brand-new-type` via the immediate pass, proving `parseInboxFilter → filterTypes=null → wildcard` end-to-end. No `wait.ts` change required (F3 verified, not modified).
- **Evidence**: event-wait 24 + tools-wait 16 → **40/40 pass**. The "a brand-new type can never make a companion deaf" guarantee (AC-5) holds at both layers.

### T006 — cleanup() re-entry guard + real-fs.watch race (Finding 03) ✅

- **(a) splice-and-close** (`event-wait.ts`): `cleanup()` now drains `watchers` via `shift()` as it closes, so a re-entrant `cleanup()` finds an empty array and can't double-close. Hardens the plan-014 single-settle teardown (makes `cleanup()` self-idempotent, not solely reliant on the `settled` guard).
- **(b) real-fs.watch race test** (`wait-for-any-fs.test.ts`): a `countingRealFactory` wraps the real `fs.watch` and counts native `close()` calls. Two tests register N=2 watchers (inbox + state.peer, inbox lane empty so the immediate pass registers rather than short-circuits) and assert `closes === 2` on **both** settle paths — fire (write outside.json mid-wait) and timeout. No leak, no double-close, under genuine watchers.
- **Evidence**: wait-for-any-fs 4 + event-wait 24 → **28/28 pass**; tsc clean.

### Whole-phase gate (AC-17)

- `just fft`: lint ✓ · format ✓ · build ✓ · typecheck ✓ · **test 1334 passed / 1 failed** · audit/sdk-check (pending re-run). The single failure was `test/runner/agent-pack/extractor.test.ts > (gg) PaxHeader` — an **ENOENT tmpdir-isolation flake unrelated to this phase**: it passes **45/45 in isolation**, and `git diff 0952e62..HEAD` shows Phase 2 touched only `event-wait.ts`, `inbox-poll.ts`, `tools-wait.test.ts`, `event-wait.test.ts` (+ uncommitted `wait-for-any-fs.test.ts`). All four coordination suites in AC-17's regression scope (event-wait, inbox-poll, tools-wait, wait-for-any-fs) are green. Not a Phase 2 regression; left untouched (fixing an unrelated flake = scope creep). fft re-run below to confirm the flake clears.
- **Formatting**: `biome check --write` reformatted 3 prior-commit files (inbox-poll.ts call wrap, event-wait.ts, event-wait.test.ts long-line wrap) — folded into the T006 commit.

---

## Phase 2 — complete

**Acceptance criteria** (all met, computational):
- **AC-3** ✅ — a message queued *before* `wait_for_any` is returned (T001 RED→GREEN via T003's immediate pass). Negative type-filter guard + corrupt-lane throw also pinned.
- **AC-4** ✅ — `wait_for_any` ⇔ `inbox_list` unacked-set parity for the same filter (T004), cap contract pinned.
- **AC-5** ✅ — wildcard wake on a brand-new/unknown type (runner + MCP) + durable-unread ack-loop (T005).
- **AC-17** ✅ — `just fft` exits 0 (lint/format/build/typecheck/test/audit/sdk-check); coordination suite **68/68** (event-wait 24, inbox-poll 12, tools-wait 16, wait-for-any-fs 4, runner-event-driven 12). Zero regression. (One unrelated `agent-pack/extractor` flake cleared on re-run; passes 45/45 in isolation.)
- **One consumed model** ✅ — `event-wait` + `inbox-poll` share the single exported `listUnackedVisible`; no parallel filter logic.

**Commits** (branch `027-companion-coordination`):
| SHA | Task | What |
|-----|------|------|
| `f86a0b9` | T002 | export `listUnackedVisible` from inbox-poll |
| `ff0a1f2` | T001+T003 | #40 fix — immediate pass + unacked watcher |
| `95be231` | T004 | wait_for_any ⇔ inbox_list parity pin |
| `eff457e` | T005 | wildcard wake + ack-loop (runner + MCP) |
| `812e468` | T006 | cleanup re-entry guard + real-fs.watch race |

**Non-goals honoured**: no transport/envelope change; `state.*` watches keep snapshot-at-entry; no `coordinationMode`/ledger work (Phase 4); no live e2e proof (unit-level only — `MINIH_FAKE_ADAPTER` was dropped with Phase 0).

**Harness**: pre-implement boot `degraded` (known minih-doctor + npm-audit baseline; code-quality sensors clean) → proceeded. Phase-end seam → observe buffer captured 2 genuine friction items (DL-001 extractor flake, SUGG-002 fft lint-before-format ordering); drain deferred to plan-complete.

## Companion debrief

- `code-review-companion` run `2026-06-15T09-22-20-918Z-e4d5`, briefed once, pinged at all 5 commit boundaries + a final drain ping.
- **Findings: 0** — the companion sent no `finding`/`summary` reply across the entire phase (`peer.lastSendAt` stayed null through ~20 min and the drain ping). Clean review.
- `control:stop` sent → run `completed`. **Farewell envelope** (`agents/code-review-companion/runs/2026-06-15T09-22-20-918Z-e4d5/output/report.json`):
  - **findings: 0** — *"Reviewed Phase 2 … across six task pings and the final `f86a0b9^..812e468` range. No blocking or actionable issues: the shared `listUnackedVisible` helper preserves `pollInboxLane` behavior, `wait_for_any` now delivers pre-queued unacked inbox messages with correct lane direction and corrupt-lane handling, parity/loop/wildcard coverage is in place, and cleanup teardown has focused real-fs coverage."* (clean APPROVE-equivalent — it explicitly checked the lane direction + the V-1 corrupt-lane path.)
  - **magicWand**: *"Add the planned inside `coordination_status`/`report_draft` MCP tool that derives tasksReceived/findingsSent/summaries/unresolved/report.findings from the durable inbox/state ledger, then pre-fills the farewell envelope so the companion doesn't hand-count or risk touching run-dir files during shutdown."*
- **Reconciliation**: 0 findings to address/defer/dispute — clean. The magicWand is **already the plan's Phase 4** (`deriveCompanionLedger` → `coordination_status` MCP tool + draft farewell) — same independent re-derivation Phase 1's companion produced. No new follow-up dossier needed; it strengthens the case for Phase 4. Surfaced as a follow-up candidate only.

