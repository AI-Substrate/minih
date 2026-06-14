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

