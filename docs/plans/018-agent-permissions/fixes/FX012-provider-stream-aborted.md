# FX012 — Adapter-side `provider_stream_aborted` synthetic event

**Created**: 2026-05-04
**Status**: PROPOSED — DEFERRED (observability layer for issue #24 root cause)
**Plan**: 018-agent-permissions
**Source**: GitHub issue [#24](https://github.com/AI-Substrate/minih/issues/24); diagnostic schema verbatim from Chainglass agent 2026-05-04 (issue comment id 4368874148).
**Domain(s)**: adapter (event emission), runner (terminalReason mapping)

---

## Problem

When the SDK provider stream aborts mid-tokens (e.g. truncation due to concurrent `copilot --resume=minih` contention, network drop, provider OOM), the run's `events.ndjson` ends in mid-`text_delta` with no terminal marker — no `assistant.streaming_complete`, no `session_end`, no `error`, no `exit`. The only signal is "the deltas stop", which is impossible to distinguish from "the model is mid-thought during a long tool call" without external context.

Concrete repro (Chainglass agent, issue #24):

```jsonc
// Last line of runs/2026-05-04T15-57-06-931Z-0a24/events.ndjson:
{"type":"text_delta","data":{"content":" for","messageId":"efeac0f3-…"}}
// 159 text_deltas total from the same messageId, then nothing.
// pid 55547 was already gone by the time anyone could investigate.
```

This forces every downstream tool (`status`, `view`, future `forensics`) to re-derive the death condition independently — and it leaves live `tail` users staring at a frozen stream with no idea why.

## Proposed Fix

In the adapter wrapper around the SDK call (`src/adapter/sdk-copilot.ts`), track the most recent in-flight `messageId` and whether `assistant.streaming_complete` was emitted for it. On SDK promise settlement (resolve OR reject), if the latest message has no terminal marker, emit a synthetic `provider_stream_aborted` event into the events.ndjson stream with full diagnostic payload. The event is the canonical, single source of truth — every downstream tool reads `events.ndjson`, so they all benefit.

The adapter wrapper runs in the parent process (NOT the dead SDK subprocess) — it owns the events.ndjson write handle and observes session end. This is the only layer where the synthetic event can come from with the full context needed.

## Scope

### Event schema (locked, from Chainglass)

```jsonc
{
  "type": "provider_stream_aborted",
  "timestamp": "2026-05-04T05:57:10.535Z",
  "data": {
    "lastMessageId": "efeac0f3-bae3-4ab8-aae3-791f44d67eac",
    "lastDeltaContent": " for",
    "totalBytesEmitted": 99,
    "elapsedSinceFirstDeltaMs": 51,
    "sdkResolution": "promise-resolved-no-terminal-marker",
    "pidAtAbort": 55547,
    "pidAliveAfterAbort": false
  }
}
```

### `sdkResolution` value union

- `'promise-resolved-no-terminal-marker'` — SDK promise resolved cleanly but the latest `messageId` never saw `assistant.streaming_complete`.
- `'promise-rejected'` — SDK promise rejected (with the rejection reason elided to keep the event compact; full reason in adapter log).
- `'adapter-timeout'` — adapter-imposed per-message timeout fired (adapter watchdog, separate from SDK timeout). Free generalisation.
- `'sdk-disconnected'` — adapter detected the underlying transport dropped.

Additive enum — readers MUST tolerate unknown values.

**`classifyResolution` input type** — discriminated union the adapter wrapper produces from SDK outcomes:

```ts
type SdkSettleResult =
  | { type: 'resolved' }
  | { type: 'rejected'; reason: unknown }
  | { type: 'timeout' }
  | { type: 'disconnected' };

function classifyResolution(settle: SdkSettleResult): SdkResolutionKind {
  switch (settle.type) {
    case 'resolved':     return 'promise-resolved-no-terminal-marker';
    case 'rejected':     return 'promise-rejected';
    case 'timeout':      return 'adapter-timeout';
    case 'disconnected': return 'sdk-disconnected';
  }
}
```

The adapter's promise-wrapping layer maps SDK outcomes (resolve / reject / per-message-timeout fire / transport-drop event) to this discriminated union before calling `classifyResolution`. Type added to `src/adapter/sdk-copilot.ts` alongside the new tracking fields.

### Multi-message turn semantics (locked design)

The adapter tracks ONLY the latest in-flight messageId. If the SDK emits multiple interleaved messages (`text_delta(messageId=A)` × N → `text_delta(messageId=B)` before `streaming_complete(A)`), the adapter sets `currentMessageId = B` and on settlement evaluates B alone. A's incomplete streaming is **silently swallowed** — this is intentional v1 design: only the most-recent in-flight message fires the synthetic event. A message that completes before the next one starts already has `streaming_complete` so it doesn't trigger anything.

**Document explicitly**: "FX012 detects abort of the last in-flight message only; partial completion of earlier messages in a multi-turn response is not tracked in v1." Future enhancement could maintain a stack of in-flight messages, but v1 keeps the state machine minimal. FX012-6 case (g) anchors this contract.

### Trigger conditions

The adapter wrapper maintains:
- `currentMessageId: string | null` — set on first `text_delta` for a new messageId.
- `currentMessageStreamingCompleted: boolean` — set on `assistant.streaming_complete` for the current messageId.
- `currentMessageFirstDeltaTs: number | null` — captured at first delta.
- `currentMessageBytesEmitted: number` — running counter.
- `lastDeltaContent: string` — last 80 bytes (for diagnostic).

On SDK promise settlement:

```ts
if (currentMessageId !== null && !currentMessageStreamingCompleted) {
  emitProviderStreamAborted({
    lastMessageId: currentMessageId,
    lastDeltaContent: lastDeltaContent.slice(-80),
    totalBytesEmitted: currentMessageBytesEmitted,
    elapsedSinceFirstDeltaMs: Date.now() - currentMessageFirstDeltaTs,
    sdkResolution: classifyResolution(promiseSettleResult),
    pidAtAbort: process.pid,
    pidAliveAfterAbort: false,  // by construction — we're in the parent process; the SDK subprocess is gone
  });
}
```

`pidAtAbort` is `process.pid` of the adapter (the parent), NOT the SDK subprocess pid (which is gone). Document this clearly — the field name is intentional from Chainglass's schema.

`pidAliveAfterAbort: false` is structurally correct here: the adapter wrapper is the layer noticing the abort, so by construction the SDK subprocess is no longer producing events. (Future enhancement: probe the actual SDK subprocess pid if we ever capture it.)

### Run.json terminalReason mapping

When the synthetic event fires, the runner ALSO sets `run.json.terminalReason: 'provider-stream-aborted'`. This pairs with FX009's `verdict: 'dead'` for orchestrator polling: if `verdict === 'dead'` AND `terminalReason === 'provider-stream-aborted'` → operator immediately knows it was a stream truncation, not a clean completion or a permission denial.

### Cross-FX synergy

When FX008 (write-deny precondition) AND FX012 (stream abort) AND FX009 (status pid probe) are all in place:

- FX008 fires events.ndjson `permission_denied` event for misconfig at boot.
- FX012 fires events.ndjson `provider_stream_aborted` for stream truncation.
- FX009 surfaces both via `verdict: 'dead'` with `terminalReason` distinguishing the two failure modes.

Single source of truth (events.ndjson) → consistent visibility surface (`verdict + terminalReason`) → cleaner orchestrator logic.

### Backward compat

Existing event consumers default-tolerate unknown event types (per workshop 002 § Q1 enum extension contract). No breaking change.

## Domain Impact

| Domain | Relationship | What Changes |
|--------|-------------|-------------|
| `adapter/sdk-copilot` | adds tracking + synthetic emit | New state fields tracked across `text_delta` / `streaming_complete` / settlement |
| `adapter/events` | new event type emitted | Re-uses existing event-write path |
| `runner` | maps event to terminalReason | Watches for `provider_stream_aborted` event in the event stream; sets `run.json.terminalReason: 'provider-stream-aborted'` |

**Domain contract change**: events.ndjson schema gains a new event type (additive). `run.json.terminalReason` enum gains `'provider-stream-aborted'` (additive). Both documented in CHANGELOG.

## Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [ ] | FX012-1 | Add tracking state to adapter wrapper. | adapter | `src/adapter/sdk-copilot.ts` | New private fields: `currentMessageId`, `currentMessageStreamingCompleted`, `currentMessageFirstDeltaTs`, `currentMessageBytesEmitted`, `lastDeltaContent`; updated on `text_delta` / `streaming_complete` / new-message events | Pure additive — no existing behavior changes |
| [ ] | FX012-2 | Emit synthetic event on SDK settlement. | adapter | `src/adapter/sdk-copilot.ts` | On promise settle, check `currentMessageId !== null && !currentMessageStreamingCompleted`; emit `provider_stream_aborted` with full schema | Schema verbatim from Chainglass (issue #24) |
| [ ] | FX012-3 | Classify SDK resolution. | adapter | `src/adapter/sdk-copilot.ts` | `classifyResolution(settle)` returns one of the 4 enum values; defaults to `'sdk-disconnected'` for ambiguous cases | Future-extensible — additive enum |
| [ ] | FX012-4 | Map event → run.json.terminalReason. | runner | `src/runner/runner.ts` event consumer path | Watch for `provider_stream_aborted` event; set `terminalReason: 'provider-stream-aborted'` on run.json before exit | Best-effort — failure to write doesn't throw |
| [ ] | FX012-5 | Adapter timeout integration. | adapter | `src/adapter/sdk-copilot.ts` | Per-message timeout (configurable via env var `MINIH_ADAPTER_PER_MESSAGE_TIMEOUT_MS`, default 600 s); on timeout, fires synthetic event with `sdkResolution: 'adapter-timeout'` | Free generalisation per Chainglass; locks the schema slot |
| [ ] | FX012-6 | Unit tests. | adapter-tests | `test/adapter/provider-stream-aborted.test.ts` (new) | (a) clean-completion → no synthetic event; (b) promise-resolved-mid-stream → event with `sdkResolution: 'promise-resolved-no-terminal-marker'`; (c) promise-rejected mid-stream → event with `sdkResolution: 'promise-rejected'`; (d) adapter timeout → event with `sdkResolution: 'adapter-timeout'`; (e) bytes/elapsed accuracy; (f) `lastDeltaContent` truncation at **80 characters** (`.slice(-80)`; assert with non-ASCII content that contains a 4-byte emoji at boundary — emoji preserved, no mid-codepoint cut); **(g) multi-message: A(text_delta×N) → B(text_delta×M, no streaming_complete) → settle → event fires with `lastMessageId = B's id`, B's content; A's state is not reported (intentional v1 semantics)**; **(h) `run.json.terminalReason` write failure (injected fs.write throws) → synthetic event STILL written to events.ndjson + stderr warning emitted; the synthetic event is the primary observability surface regardless of run.json write success** | `FakeAgentAdapter` — no real SDK |
| [ ] | FX012-7 | Regression test against Chainglass repro fixture. | adapter-tests | `test/adapter/provider-stream-aborted.test.ts` | Synthesise events.ndjson tail mirroring the issue #24 repro (159 text_deltas + abrupt end); assert synthetic event would fire with the right shape | Cite issue commenter id 4368874148 |
| [ ] | FX012-8 | CHANGELOG + docs. | docs | `CHANGELOG.md`, `docs/how/companion-mode.md` § Forensics or new section, `docs/domains/adapter/domain.md` | CHANGELOG: new event type + terminalReason value; companion-mode.md section: "What happens when the provider stream truncates" walking through the synthetic event + verdict mapping | Cross-link to FX008/FX009 |

## Workshops Consumed

- None directly. References workshop 002 § Q1 (event enum extension contract — additive only).

## Acceptance

- **AC-FX12.1**: Clean session completion produces NO synthetic event.
- **AC-FX12.2**: Mid-stream SDK promise resolution produces `provider_stream_aborted` event with `sdkResolution: 'promise-resolved-no-terminal-marker'`.
- **AC-FX12.3**: Mid-stream SDK rejection produces event with `sdkResolution: 'promise-rejected'`.
- **AC-FX12.4**: Adapter per-message timeout produces event with `sdkResolution: 'adapter-timeout'`.
- **AC-FX12.5**: Event schema EXACTLY matches Chainglass-locked shape (all 7 fields populated; types correct; ISO timestamp). Schema documentation notes that `lastDeltaContent` MAY contain sensitive model output (treat events.ndjson as per-run sensitive data).
- **AC-FX12.6**: `run.json.terminalReason: 'provider-stream-aborted'` set on event observation. **Best-effort**: if the run.json write fails (read-only mount, EACCES, etc.), a stderr warning is emitted but the synthetic event is still written to events.ndjson — the synthetic event is the primary observability surface; run.json terminalReason is enrichment.
- **AC-FX12.7**: `lastDeltaContent` truncated to **80 characters** (`.slice(-80)`; characters not bytes — multi-byte UTF-8 codepoints preserved). FX012-6 case (f) asserts with emoji boundary.
- **AC-FX12.8**: Existing event consumers tolerate the new event type without modification.
- **AC-FX12.9** (cross-FX integration — conditional): When BOTH the synthetic event fires AND `run.json.terminalReason` write succeeds, `minih status` returns `verdict: 'dead'` (FX009 pid probe) AND envelope contains `terminalReason: 'provider-stream-aborted'` (FX009-3 passthrough). Distinguishes stream-truncation deaths from permission-deaths from clean crashes. **If run.json.terminalReason write fails (per AC-FX12.6 best-effort), the synthetic event in events.ndjson remains the canonical record; verdict='dead' still fires but terminalReason may be absent from the status envelope.**
- **AC-FX12.10** (multi-message v1 semantics): When multiple messages interleave, only the latest in-flight message fires the synthetic event; earlier incomplete-but-superseded messages are NOT reported. Demonstrated by FX012-6 case (g). Documented in companion-mode.md § Forensics.

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| False positives — clean session that legitimately doesn't emit `streaming_complete` (e.g. tool-only response with no text). | Low. | Trigger gates on `currentMessageId !== null` — only fires if a `text_delta` was seen. Tool-only responses without text don't increment `currentMessageId`. Verified by FX012-6 case (a). |
| Adapter watchdog timeout fires on long-but-legitimate tool calls. | Medium — depends on default. | Default 600 s per message — generous. Configurable via env var. Operators with sustained-tool-call workloads bump it higher. |
| `lastDeltaContent` may capture partial multi-byte UTF-8. | Resolved by character-based slicing. | `.slice(-80)` is character-based (JavaScript string semantics), so multi-byte codepoints are preserved. FX012-6 case (f) asserts with emoji at boundary. AC-FX12.7 wording is "80 characters". |
| Event emission throws (e.g. events.ndjson handle dropped). | Low. | Wrap emission in try/catch; failure logged to stderr; never propagates to the run. Treats observability as best-effort, like the 5-signal protocol's signal failures. |
| `pidAliveAfterAbort` field name confuses (it's the adapter's pid, not the SDK's). | Medium. | Documented in adapter/domain.md; field semantics: "true means the parent (adapter) is alive when the abort is observed; false means even the parent is on its way out". Name kept because Chainglass schema is locked. Future enhancement could capture SDK subprocess pid at spawn for tighter semantics. |
| **`lastDeltaContent` may contain sensitive model output** (API keys, PII, proprietary data). | Medium — depends on workload. | Up to 80 characters of streamed text land in events.ndjson permanently. v1 mitigation: events.ndjson is owned by the runner's run-dir isolation (inherits OS permissions from the run dir); not explicitly chmod'd. Treat events.ndjson as per-run sensitive data subject to the same access controls as the rest of the run dir. Document in `companion-mode.md` § Forensics. AC-FX12.5 references the sensitive-data note. Future enhancement: redaction of suspected secrets via regex patterns. |

## Out of scope

- **Healing the truncated stream.** Synthetic event is observability only.
- **Cross-host event aggregation.** Local events.ndjson only.
- **Replay of the truncated stream.** Different feature.
- **Probing the SDK subprocess pid.** Adapter doesn't currently capture it; if added in future, `pidAliveAfterAbort` semantics tighten.
- **Synthetic events for OTHER abnormal terminations** (e.g. `tool_call_aborted`, `state_corrupted`). FX012 is scoped to provider stream abort; future FX-events follow the same shape pattern.

## Testing approach

- **Unit tests** (FX012-6): 6 cases covering happy + 4 abort flavours + truncation accuracy. Uses `FakeAgentAdapter` synthesising the event sequence.
- **Regression fixture** (FX012-7): mirror of Chainglass real run shape (159 text_deltas + cliff edge).
- **No real SDK in CI** — fakes only. Chainglass agent volunteered to test against the actual `runs/2026-05-04T15-57-06-931Z-0a24` fixture during their next iteration.

## Dependencies

- **Independent of FX008 / FX010**.
- **Composes with FX009 + FX011** — `verdict: 'dead'` + `terminalReason: 'provider-stream-aborted'` is the integrated diagnostic.

## Discoveries & Learnings

_Populated during implementation by plan-6._

| Date | Task | Type | Discovery | Resolution |
|------|------|------|-----------|------------|

---

## Validation Record (2026-05-04)

| Agent | Lenses Covered | Issues | Verdict |
|-------|---------------|--------|---------|
| Source-Truth (Sonnet 4.6) | Factual Accuracy, Hidden Assumptions | 0 CRIT, 0 HIGH (FX012-specific), 0 MED, 0 LOW | ✅ (schema verbatim verified) |
| Cross-Reference (Sonnet 4.6) | Integration & Ripple, Concept Documentation | 0 CRIT, 0 HIGH (FX012-specific), 1 MED (issue thread renumber FX011→FX012 trace), 0 LOW | ⚠️ |
| Completeness (Sonnet 4.6) | Edge Cases, Technical Constraints, Security & Privacy | 0 CRIT, 3 HIGH (bytes/chars contradiction, sensitive-data risk, multi-message turn), 2 MED (classifyResolution input, terminalReason write failure) — all fixed inline | ⚠️ → ✅ |
| Forward-Compatibility (Opus 4.7) | Forward-Compatibility, Technical Constraints | 0 CRIT, 0 HIGH, 0 MED, 1 LOW (`pidAtAbort` semantic drift — documented inline as future enhancement) | ✅ |

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| plan-6 FX012 implementer | adapter integration clean + schema verbatim + classifyResolution typed | encapsulation-lockout | ✅ | Schema reproduces Chainglass's 7 fields verbatim; `SdkSettleResult` discriminated union spec'd; multi-message v1 semantics locked |
| FX009 cross-FX integration | terminalReason consumable from minih status | contract-drift | ✅ | AC-FX12.6 best-effort write + AC-FX12.9 surfaces in FX009-3 envelope passthrough |
| Issue #24 thread — adapter-side | locked design | contract-drift | ✅ | FX012-1..3 all in `src/adapter/sdk-copilot.ts`; parent process owns events.ndjson handle |
| Issue #24 thread — schema verbatim | 7 fields preserved | contract-drift | ✅ | Field-for-field match with Chainglass commenter id 4368874148 |

**Outcome alignment**: FX012 advances *"Safety-by-default for agents; trust ladder for installed packs; credible answer to 'what can this agent do to my machine?'"* by making provider-stream truncation an observable terminalReason in the canonical audit trail rather than a silent frozen tail — when paired with FX009/FX011 the operator gets a clean diagnostic surface (`verdict='dead' AND terminalReason='provider-stream-aborted'`) that distinguishes stream-truncation deaths from permission-deaths from clean crashes.

**Standalone?**: No — composes with FX009 + FX011 for the integrated diagnostic.

### Fixes applied (HIGH)
- COMPL-1 fixed: 80-bytes/chars contradiction resolved → **80 characters** consistently (`.slice(-80)` semantics); AC-FX12.7 + Risks updated; FX012-6 case (f) asserts with emoji
- COMPL-2 fixed: sensitive-data risk acknowledged in Risks table + AC-FX12.5 documentation note
- COMPL-3 fixed: multi-message turn semantics locked in Scope (v1 = latest in-flight message only); AC-FX12.10 + FX012-6 case (g) anchors

### Fixes applied (MEDIUM)
- COMPL-4 fixed: `classifyResolution` input typed as `SdkSettleResult` discriminated union with explicit cases; pseudocode in Scope
- COMPL-5 fixed: terminalReason write-failure path is best-effort; AC-FX12.6 explicit + AC-FX12.9 conditional + FX012-6 case (h)

### Open (LOW — user decision)
- FC-2: `pidAtAbort` semantic drift (field name implies SDK pid; populated with adapter pid) — documented as future enhancement in Risks table; field name kept for Chainglass schema lock

### Note (MEDIUM)
- XR-3: issue #24 "Locked." comment uses draft FX011 number; WIP update corrects to FX012. Not a dossier issue per se — the dossier is correctly numbered FX012. Optional: append correction to the locked comment.

Overall: ⚠️ **VALIDATED WITH FIXES** — 3 HIGH + 2 MED resolved inline; 1 LOW remains for user decision (pidAtAbort name vs semantics); ready for `/plan-6-v2-implement-phase --fix FX012`.
