# Research Report: Peer Activity Telemetry — Integration Surface

**Generated**: 2026-04-29T15:35+10:00
**Research Query**: "ground-truth peer activity — derive from events.ndjson and surface in outside CLI envelopes"
**Mode**: Pre-Plan (associated with new ordinal `012-peer-activity-telemetry`)
**Location**: `docs/plans/012-peer-activity-telemetry/research-dossier.md`
**FlowSpace**: Not used (focused exploration was sufficient given workshop already locks design)
**Findings**: 21 across 3 streams + 1 critical correction
**Authoritative design**: [Workshop 001 in plan 011](../011-retro-harvest-loop/workshops/001-peer-activity-telemetry.md)

## Executive Summary

### What This Research Confirms

Plan 012 implements the design locked in `docs/plans/011-retro-harvest-loop/workshops/001-peer-activity-telemetry.md`. This dossier validates the design against the live codebase and identifies the precise integration points. **The workshop's assumed event shape, file layout, and command surface are accurate** with one minor exception (no `schemaVersion` on side-state files).

### Business Purpose

Coordinated agent runs can suffer **silent failures** where the orchestrator's message lands in the agent's inbox but the agent's `inbox_list` filter excludes the message type — the agent is alive, polling, healthy, but **structurally deaf** to the message just sent. This is what bit plan 011's Power On Mode for ~30 min. State is self-reported and can be wrong/stale; **telemetry is observed and objective**. The fix: derive peer activity from `events.ndjson` and inject a `peer` block (with a single-word `verdict`) into the response of every transactional outside-lane command.

### Key Insights

1. **Event shape is exactly what the workshop assumes.** Canonical `tool_call` events on disk match the workshop's example byte-for-byte. `data.input` contains the agent's full SDK args including `waitForAny` and `waitMs`. Confirmed via live sampling of `agents/code-review-companion/runs/2026-04-29T13-12-02-428Z-7abb/events.ndjson`.
2. **The integration is concentrated.** All five target commands live in ONE file (`src/cli/commands/outside.ts`), each with a single `formatSuccess(...)` call site and a single TTY stderr block. Fewer than 10 surgical insertion points to add the `peer` block project-wide.
3. **Existing primitives cover most of the read path.** `state.ts:readStateLazy`, `run-manifest.ts:readManifest`, and `coordination.ts:resolveCoordinationRunOrExit` give us state, run.json, and runDir resolution for free. The new code is essentially **one new module** (`peer-activity.ts`) plus tiny envelope additions.
4. **No reverse-tail primitive exists for events.ndjson.** `tail.ts` polls every 200ms (streaming UX, not a one-shot reader); `status.ts` reads it synchronously top-to-bottom for counts; `inbox-poll.ts` is for inbox lanes, not events. We need a small bounded reverse-line reader (~30 LOC).
5. **Writes are sync (`appendFileSync`); torn writes from app code are not a concern.** OS-level append atomicity protects us from line splitting; only crash-loss of last append is possible (acceptable for `verdict` derivation since "missing latest poll" naturally degrades to `silent`).

### Quick Stats

- **Components touched**: 1 new module (`src/runner/peer-activity.ts`), 5 envelope additions in `src/cli/commands/outside.ts`, optional flag wiring (`--strict-peer`)
- **Existing primitives reused**: `state.ts`, `run-manifest.ts`, `coordination.ts`, `output.ts:formatSuccess`
- **Test coverage to mirror**: `state.test.ts`, `run-manifest.test.ts`, `inbox-poll.test.ts`, `outside-inbox-wait.test.ts`, `state.test.ts`, `retros.test.ts`
- **Domains**: `runner` (primary, derivation lives here), `cli` (envelope/TTY surface), `mcp` (informational only — observed, not modified)
- **Complexity**: Low. Pure-function derivation + additive envelope. No state, no async coordination, no migrations.

---

## How It Currently Works

### Event production (`runner` domain)

| Step | Location | What happens |
|---|---|---|
| Run start | `src/runner/runner.ts:415-476` | `run.json` written via `writeManifest()`; `events.ndjson` initialized to empty (or prepended with `resume` line on resume-in-place) at `runner.ts:384-413, 623-659` |
| Tool call observed | `src/adapter/sdk-copilot.ts:326-335` | SDK `tool.execution_start` payload normalized into `tool_call` event; `toolName` is the SDK's verbatim name (which for inside MCP tools IS the prefixed `minih-coordination-*` form), `input` is the full `arguments` object |
| Event written | `src/runner/runner.ts:657-659` | `appendFileSync(eventsPath, JSON.stringify(event) + '\n')` — synchronous, line-atomic at the syscall level |

**Live event sample** (from a coordinated run):

```jsonc
// agents/code-review-companion/runs/2026-04-29T13-12-02-428Z-7abb/events.ndjson
{
  "type": "tool_call",
  "timestamp": "2026-04-29T03:13:01.877Z",
  "data": {
    "toolName": "minih-coordination-inbox_list",
    "input": { "unread": true, "waitMs": 30000, "waitForAny": ["task","question","directive","control"] },
    "toolCallId": "tooluse_kRyFj6RFd5oIBHKjbTNtCW"
  }
}
```

This matches the workshop's assumed shape exactly. **No correction needed to the derivation contract.**

### State and manifest reads

| Concern | Reader | Path |
|---|---|---|
| `state/inside.json` | `readStateLazy()` in `src/runner/state.ts:76-158` | `<runDir>/state/inside.json` |
| `run.json` | `readManifest()` in `src/runner/run-manifest.ts:52-75` | `<runDir>/run.json` |
| `runDir` resolution | `resolveCoordinationRunOrExit()` in `src/cli/coordination.ts:205-280` | Slug + optional `--run` → full runDir |

`InsideState` is `{ status, data, updatedAt, updatedBy }` (`src/runner/types.ts:204-225`) — **no `schemaVersion`** despite the workshop's example header. `LiveRunManifest` exposes `status: starting|active|idle|completing|completed|failed|stale` (`types.ts:260-296`), which the verdict logic uses for the `dead` state.

### Outside-lane CLI command surface

All five target commands are in `src/cli/commands/outside.ts`:

| Command | Handler | Envelope site (insert `peer` here) | TTY render site |
|---|---|---|---|
| `outside inbox send` | `outside.ts:92-200` | `outside.ts:191-200` | `outside.ts:185-189` |
| `outside inbox list` | `outside.ts:101-115, 204-257` | `outside.ts:593-606` (`emitListResult`) | `outside.ts:581-591` |
| `outside state set` | `outside.ts:296-333` | `outside.ts:329-331` | `outside.ts:324-328` |
| `outside state transition` | `outside.ts:335-405` | `outside.ts:370-379, 394-403` | `outside.ts:389-393` |
| `outside retro add` | `outside.ts:429-483` | `outside.ts:473-482` | `outside.ts:468-472` |

Each has a single `formatSuccess(cmd, { ... })` call and a single `process.stderr.isTTY` block. Adding a `peer` block is mechanical: derive once near the top of the handler, spread into the envelope's `data`, append a verdict line to the stderr block.

---

## Critical Findings

### 🚨 IA-01: Workshop's event-shape contract is fully validated

**Impact**: High (de-risks the derivation primitive)
**Evidence**: `agents/code-review-companion/runs/2026-04-29T13-12-02-428Z-7abb/events.ndjson` line containing `"toolName":"minih-coordination-inbox_list"` matches workshop §"What We Can Derive" lines 64-113 byte-for-byte. `data.input.waitForAny` and `data.input.waitMs` are present where promised.
**Required action**: None — proceed with workshop's contract for `derivePeerActivity`. No translation layer needed between SDK shape and derivation input.

### 🚨 IA-02: SDK records verbatim tool names, not the MCP registry's normalized names

**Impact**: Medium (correct understanding required)
**Evidence**: `src/adapter/sdk-copilot.ts:326-335` records `tool.execution_start.toolName` as-is. For coordinated-run events this happens to equal `minih-coordination-inbox_list` etc. (because that IS the SDK-visible name registered by the inside MCP server), but for non-coordinated tool calls (e.g. `bash`, `task`, `view`) the name is the SDK's bare name. `src/mcp/types.ts:307-315` defines aliases that normalize legacy dotted names — these aliases are NOT applied to recorded events.
**Required action**: `derivePeerActivity` must filter by the prefixed forms (`minih-coordination-inbox_list`, `minih-coordination-inbox_send`, `minih-coordination-inbox_ack`, `minih-coordination-state_*`). The workshop already uses the correct names; this finding just notes the runtime invariant we depend on.

### ⚠️ DC-03: No bounded reverse-tail reader for `events.ndjson` exists yet

**Impact**: Medium (small new utility needed)
**Evidence**: `src/cli/commands/tail.ts:86-146` polls every 200ms (streaming UX); `src/cli/commands/status.ts:29-83,150-189` reads forward synchronously for counts; `src/runner/inbox-poll.ts` is lane-oriented. No "read last N lines" helper.
**Required action**: Add a tiny reverse-tail helper (probably inside `peer-activity.ts` itself, ~30 LOC: `fs.statSync` + `fs.openSync` + read backward in 64KB chunks until N newlines). Pure function, easy to unit-test. Workshop §"Open Question Q2" recommends 1000 lines for v1.

### ✅ IC-04: Envelope shape is centralized and additive `peer` is safe

**Impact**: Low (no breaking-change risk)
**Evidence**: `MinihEnvelope` + `formatSuccess` at `src/cli/output.ts:63-113` always wrap a `data` field. Workshop spec adds `data.peer = { verdict, ... }`. Existing tests (`test/cli/outside-inbox-wait.test.ts:13-22, 121-179`) snapshot specific fields, not whole-envelope strict equality, so additive fields don't break them.
**Required action**: Confirmed safe. Add new tests that ASSERT `peer.verdict` for each command rather than snapshot-locking the whole envelope.

### ⚠️ QT-05: Sync `appendFileSync` is line-atomic but not crash-durable

**Impact**: Low (acceptable trade-off; design accommodates)
**Evidence**: `runner.ts:657-659` uses `appendFileSync`. POSIX guarantees atomic append for writes < `PIPE_BUF` (which our JSON lines easily fit), so torn writes from app code are not a concern. There is no `fsync`, so a power loss can lose the last appended line — but the verdict logic naturally degrades (missing last poll → `silent`).
**Required action**: None. Document in dossier; design already tolerates this.

### ✅ DE-06: All workshop-listed target commands exist, in one file, with consistent shape

**Impact**: Low (positive — reduces implementation surface)
**Evidence**: All five commands are in `src/cli/commands/outside.ts`. Each follows the same `parseArgs → resolve runDir → execute → formatSuccess + stderr` pattern. Patterns for `--strict-*` and `--force` flags don't currently exist on these commands but adding `--strict-peer` follows the established `commander.option(...)` style at `outside.ts:101-115`.
**Required action**: None — implementation will be parallel additions to each handler.

---

## Dependencies & Integration

### What this research depends on

| Dependency | Reason | Risk |
|---|---|---|
| `events.ndjson` shape stability | Derivation reads the canonical `tool_call` event | Low — shape is locked in `src/adapter/events.ts:107-114` (typed) |
| Inside MCP tool names | Filter must match `minih-coordination-*` | Low — names are stable; covered by `src/mcp/types.ts` |
| `state/inside.json` schema | Verdict cross-references `selfReportedState` | Low — schema is typed in `types.ts:204-225` |
| `run.json` `status` field | Verdict's `dead` rule reads it | Low — typed enum `types.ts:260-268` |
| `formatSuccess` envelope | New `peer` field is additive | Low — confirmed by IC-04 |

### What depends on this (consumers)

- **Plan 011 Power On Mode** — would have caught the deafness bug at send-time (the lived motivation).
- **Future companion / coordination protocols** — get structural visibility for free without per-protocol work.
- **`minih doctor`** — workshop §"Where it's invoked" suggests doctor lists deaf agents in audit; this is an obvious consumer once the primitive lands.

---

## Modification Considerations

### ✅ Safe to add (low risk)

- New module `src/runner/peer-activity.ts` — pure function, no I/O coupling
- Additive `peer` field on existing envelopes — backward compatible (consumers treat absence as "unknown")
- New `--strict-peer` flag — opt-in, defaults off, doesn't change existing exit codes

### ⚠️ Modify with caution

- **TTY rendering of verdict line** — must not break `process.stderr.isTTY` gating (existing tests assert clean stdout when piped). Render verdict only when TTY, not in piped mode.
- **`outside inbox list --wait`** — currently long-polls; the `peer` block should reflect the moment the list call resolved, not the moment the poll started, to avoid stale snapshots.

### 🚫 Out of scope for plan 012 (defer to future)

- **Inside-side reverse symmetry** (workshop Q6) — having the inside MCP `inbox_list` return outside peer data. Defer to v2.
- **Auto-coerce policy C** (workshop §"Policy C") — rewriting message types automatically. Defer.
- **Caching `derivePeerActivity` results** (workshop Q3) — sub-millisecond cost makes caching premature.

---

## Prior Learnings

### 📚 Prior Learning PL-01: Power On Mode silent failure (the lived motivation)

**Source**: `docs/plans/011-retro-harvest-loop/prompts/option-c/runs/001-power-on.md` (MH-009, HIGH severity)
**Type**: gotcha + structural-fix
**Date**: 2026-04-29

**What was found**: The companion's `inbox_list waitForAny` filter was `['task','question','directive','control']`. Power On Mode pinged with types `briefing` and `review-request`, both excluded. Companion was alive, polling, healthy. Tool calls were RECORDED. But no signal surfaced the mismatch to the orchestrator. Drained 60 seconds → assumed companion dead → wrote a triumphant retrospective with a dead companion. After idle-budget recovery the companion noticed via state-trace, recovered, produced a proper review.

**Action for plan 012**: The `verdict: deaf` rule (workshop §"Verdict states") is the structural fix for this exact failure mode. It's the v1 must-have, not a nice-to-have.

### 📚 Prior Learning PL-02: State is self-reported and can lie (or simply not get set)

**Source**: workshop 001 §"Two Sources of Truth" + plan 011's MH-009 narrative
**Type**: insight

**What was found**: An agent can claim `state: idle` (correctly) while being structurally unable to receive a message. State alone wouldn't have caught plan 011's bug because the agent's self-report was accurate — the bug was in a different layer.

**Action for plan 012**: Verdict comes from telemetry, not from state. State is reported alongside as `selfReportedState` for cross-check, but never influences the verdict.

### 📚 Prior Learning PL-03: `MINIH_PLAN_ID` showed how to thread context without polluting `MINIH_ENV_KEYS`

**Source**: plan 011 implementation (`src/runner/runner.ts:~330` planId capture pattern)
**Type**: pattern

**What was found**: Function-local capture at `runAgent` entry (before any cleanup loops) is the right pattern when you need to thread runtime context that shouldn't be auto-stripped. `MINIH_PLAN_ID` deliberately avoided the cleanup list.

**Action for plan 012**: If `derivePeerActivity` needs any runtime context (it shouldn't — it's pure-function over disk state), follow the same pattern.

### 📚 Prior Learning PL-04: Resume-in-place prepends a synthetic `resume` event line

**Source**: `src/runner/runner.ts:432-473`, plan 010 HF-003
**Type**: behavior to handle

**What was found**: On resume-in-place, `events.ndjson` gains a `{type: 'resume', ts: ...}` line. The reverse-tail must filter for `type: 'tool_call'` only — other event types exist (`session_start`, `resume`, `session_idle`, etc.).

**Action for plan 012**: `derivePeerActivity` filters for `type === 'tool_call'` AND `data.toolName` ∈ the coordination tool set. Other event types are simply skipped.

---

## Domain Context

### Existing Domains Relevant

| Domain | Relationship | Relevant Contracts | Key Components |
|---|---|---|---|
| `runner` | **Primary** — derivation lives here | `events.ndjson` shape, `state.ts:readStateLazy`, `run-manifest.ts:readManifest` | `src/runner/peer-activity.ts` (new), `src/runner/state.ts`, `src/runner/run-manifest.ts` |
| `cli` | **Surface** — envelope & TTY rendering | `formatSuccess`, `outside.ts` handlers, `coordination.ts:resolveCoordinationRunOrExit` | `src/cli/commands/outside.ts`, `src/cli/output.ts`, `src/cli/coordination.ts` |
| `mcp` | **Observed only** — read indirectly via events | Tool name registry (`minih-coordination-*`) | `src/mcp/types.ts` (no changes needed) |
| `adapter` | **Source** — produces the events | `tool_call` event shape `src/adapter/events.ts:107-114` | No changes needed |

### Domain map position

Plan 012 sits cleanly inside the existing topology. New `peer-activity.ts` is a pure runner-domain primitive that takes a runDir and returns a verdict + facts. CLI imports it from `src/runner/index.ts` (re-export) and uses it at envelope-construction sites. **No new cross-domain contracts; no boundary changes.**

### Domain actions

- **No new domain.** The work fits within `runner` and `cli` domain boundaries.
- **History rows** required at end: `docs/domains/runner/domain.md` (new history entry — `peer-activity.ts` primitive) and `docs/domains/cli/domain.md` (new history entry — `peer` envelope field + `--strict-peer` flag).

---

## Recommendations

### Implementation order (for plan-3-architect to consider)

1. **Foundation** — `src/runner/peer-activity.ts` with `derivePeerActivity({ runDir, messageType, now, tailLines })` returning `{ verdict, willMatchType, lastPollAt, ... }`. Pure function, deterministic, fully unit-testable with fixture event lines.
2. **Bounded reverse-tail** — internal helper or co-located utility (`readLastNLines(path, n)`). Could be exported from `peer-activity.ts` if reused later by doctor/status.
3. **Envelope wiring** — five surgical inserts in `outside.ts`, all following the same shape:
   ```ts
   const peer = derivePeerActivity({ runDir, messageType, now: () => Date.now() });
   exitWithEnvelope(formatSuccess(cmd, { ...existing, peer }));
   ```
4. **TTY rendering** — small helper `formatPeerVerdict(peer)` returning a 2-3 line string with the verdict and reason; write to stderr inside existing `if (process.stderr.isTTY)` blocks.
5. **`--strict-peer` flag** — opt-in, exits non-zero with E1XX `DEAF_PEER` when verdict === 'deaf'.
6. **Tests** — fixture-driven unit tests for the derivation; integration tests for one or two commands asserting `peer.verdict` in the envelope.
7. **Docs + domain history** — update AGENTS_README "Improvement Loop" or add a "Coordination Visibility" section; update `docs/domains/{runner,cli}/domain.md` history rows.

### What to avoid

- **Don't reuse `inbox-poll.ts`** — it's lane-oriented (messages.ndjson), not event-stream-oriented. Keep `peer-activity.ts` standalone.
- **Don't try to be transactional** (workshop §F8) — the snapshot is ground truth at the moment of read; subsequent agent re-polls are not our problem.
- **Don't surface `peer` for non-coordinated agents** — workshop §F7. If `state/inside.json` doesn't exist, return `verdict: 'n/a'` (or omit the block entirely).

---

## External Research Opportunities

None identified during exploration. Workshop already resolved all design questions that required external thinking; this dossier confirms code-side feasibility. **Skip `/deepresearch` and proceed directly to `/plan-1b-specify`.**

---

## Appendix: File Inventory

### New files (plan 012 will create)

- `src/runner/peer-activity.ts` — derivation primitive
- `test/runner/peer-activity.test.ts` — unit tests with fixture events
- `test/cli/outside-peer.test.ts` — integration tests for envelope shape

### Files to modify

| File | Change | Reason |
|---|---|---|
| `src/runner/index.ts` | Export `derivePeerActivity` and types | Public API surface for CLI |
| `src/cli/commands/outside.ts` | 5 envelope inserts + 5 TTY render lines + `--strict-peer` flag wiring on send | Surface design |
| `src/cli/output.ts` | Optional: type the `peer` block on envelopes | Type safety; not strictly required (envelopes are loosely typed today) |
| `docs/domains/runner/domain.md` | History row | Domain rule |
| `docs/domains/cli/domain.md` | History row | Domain rule |
| `AGENTS_README.md` | Optional: short § "Coordination visibility" | Operator awareness |

### Reference files (read-only during implementation)

- `src/adapter/events.ts:107-114` — `tool_call` event type
- `src/adapter/sdk-copilot.ts:326-335` — event recording site
- `src/runner/runner.ts:657-659` — append site
- `src/runner/state.ts:76-158` — state reader
- `src/runner/run-manifest.ts:52-75` — manifest reader
- `src/mcp/types.ts:6-15, 165-301` — canonical tool names
- `docs/plans/011-retro-harvest-loop/workshops/001-peer-activity-telemetry.md` — authoritative design

### Test fixtures to mirror

- `test/runner/state.test.ts:41-176` — readStateLazy patterns
- `test/runner/run-manifest.test.ts:26-176` — manifest patterns
- `test/runner/inbox-poll.test.ts:81-240` — poll-primitive patterns
- `test/cli/outside-inbox-wait.test.ts:13-22, 121-179` — envelope assertions

---

## Next Steps

1. **Run `/plan-1b-v2-specify "peer activity telemetry — derive peer verdict from events.ndjson and surface in outside-lane envelopes"`** to create the spec. The workshop already covers WHAT/WHY in depth; the spec will be Simple-mode with CS-2.
2. **Then `/plan-2-v2-clarify`** for any remaining choices (likely just: `tailLines` default, `--strict-peer` exit code, doctor integration timing).
3. **Then `/plan-3-v2-architect`** — small plan, 1 phase, ~6-8 tasks.
4. **Then `/plan-4-v2-complete-the-plan` + validation** — mandatory gate.
5. **Then `/plan-6-v2-implement-phase`** with Power On Mode (companion is now familiar with the protocol; bug from plan 011 won't recur because we explicitly fix the filter vocabulary as part of this plan).

---

**Research Complete**: 2026-04-29T15:40+10:00
**Report Location**: `docs/plans/012-peer-activity-telemetry/research-dossier.md`
