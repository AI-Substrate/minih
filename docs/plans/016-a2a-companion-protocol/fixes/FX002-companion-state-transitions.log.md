# Execution Log: FX002 — Companion state transitions + wait_for_any investigation

## FX002-1 verdict (2026-05-01)

**Decision-table outcome: NONE OF THE THREE PRE-DEFINED PATHS APPLIES — a fourth path emerged.**

### Evidence (from `agents/demo-companion/runs/2026-05-01T11-18-23-346Z-04bc/`)

| Question | Answer | Source |
|---|---|---|
| Was the briefing acked? | **YES** at 01:19:07.159Z (`01KQGHWDWQ0SNJSEG8EKFTYH80`) | `inbox/inside/messages.ndjson` |
| Was a greeting reply sent? | **YES** at 01:19:22.051Z, threaded with `ackOf` | `inbox/inside/messages.ndjson` |
| Did `wait_for_any` wake on `inbox.message`? | **YES** — briefing handled within 7 seconds of arrival | tool-call timing |
| Were `state_transition` calls made by the companion? | **YES** — 5 calls (`idle→idle` × 3, `idle→reading` × 1, `idle→idle` × 1) | `events.ndjson` tool_call events |
| Did `state_transition` calls land in `state/history.ndjson`? | **NO** — `state/` directory is EMPTY | `ls agents/demo-companion/runs/<run>/state/` |
| Why didn't they land? | **Schema rejection** — `'reading'` returned `"MCP server 'minih-coordination': state does not match inside state schema"`; all other calls were `idle→idle` no-ops (`transitioned: false`) | tool_result events |

### Why: vocabulary ↔ schema enum mismatch

The default inside-state schema (`src/schemas/inside-state.json`) enforces enum:
```
idle | in-progress | paused | reviewing | complete | error
```

The `demo-companion/prompt.md` vocabulary uses:
```
idle | reading | reporting | blocked | stopping
```

Only `idle` overlaps. Every other status the prompt asks for is rejected by AJV. Demo-companion ships **no** custom `inside-state.schema.json` (no `agents/demo-companion/state/inside-state.schema.json`), so the default is enforced.

The companion's prompt does NOT instruct the model to handle schema rejections — it just continues with `inbox_send`. Hence: replies land, state never moves, workbench timeline empty.

### Verdict mapped to FX002 §Proposed Fix decision table

The dossier's decision table has three rows. **None apply cleanly.** A fourth row is needed:

| Row 4 (NEW) | State transitions ATTEMPTED but REJECTED by schema (vocabulary mismatch) | **Path C** — fix vocabulary + add systemic guard |

### Path C scope

**Per-agent fix** (the demo's bug):
1. Either rewrite `demo-companion/prompt.md` to use the default schema's vocabulary, OR ship `agents/demo-companion/state/inside-state.schema.json` with the prompt's vocabulary as the enum.
2. Decision: **ship a custom schema** — the prompt's verbs (`reading`, `reporting`, `blocked`, `stopping`) read better for a chatty conversational companion than the generic `in-progress`/`paused`/`reviewing`. Custom schema preserves the demo's intent.

**Systemic fix** (the real lesson):
3. `doctor` should warn when an agent's `prompt.md` mentions a `state_transition` to a status that isn't in the resolved inside-state schema enum. Equivalent for `state_set` calls. This is the foot-gun any future agent author would hit; it's why our demo silently failed.
4. The companion-mode preamble (or `_shared/preamble.md`) should tell agents to `inbox_send` a `progress` message on schema rejection so the operator can see the failure rather than it being silent.

### Conclusion

- **Path A is partially right**: prompt is involved (vocabulary), but not in the way FX002-2/-3 framed it.
- **Path B is wrong**: `wait_for_any` event routing is fine. No `src/mcp/` work needed for `wait_for_any`.
- **Path C is the actual fix**: schema/vocabulary harmonisation + doctor warning.

### What FX002 becomes

FX002-2/-3 (prompt hardening of Path A) — **OBSOLETE** as written. Replace with Path C tasks.
FX002-4/-5 (Path B mcp `wait_for_any` fix) — **DELETE**. Not needed.
FX002-6 (verification) — keep, with Path C scope.

### Bonus observations during investigation

- `run.json` shows `counters.messages: 0` despite 3 inside messages and 1 outside message present on disk. Counter accounting is broken (separate bug — file as a tiny fix or note).
- The companion's "Still here — waiting on next message" heartbeat at 01:24:56 is correct behaviour from prompt — proof the main loop is healthy.
- `state_get` was called 3 times by the companion (likely as boot-time orientation) and succeeded each time, returning the existing idle state.


---

## FX002-5 verification (2026-05-01)

Headless verification — fresh run `2026-05-01T16-52-13-658Z-4999`.

### Sequence
1. Started `npx minih run demo-companion` (background)
2. Sent briefing via `outside inbox send` (id `01KQH4Z139MAWJ49MZR196B0RG`)
3. Companion acked + replied with greeting (id `01KQH4Z8R8W7WJ64Y1YDSE8G53`, threaded with `ackOf`)
4. Sent `control:stop`
5. Companion wrote farewell envelope; run completed cleanly

### state/history.ndjson populated correctly

```ndjson
{"ts":"2026-05-01T06:52:39.135Z","side":"inside","from":"idle","to":"reading","reason":"reading briefing: Topic: FX002 verification","peerStateAtTime":{"status":"idle"}}
{"ts":"2026-05-01T06:52:40.788Z","side":"inside","from":"reading","to":"reporting","reason":"greeting","peerStateAtTime":{"status":"idle"}}
{"ts":"2026-05-01T06:52:43.144Z","side":"inside","from":"reporting","to":"idle","reason":"briefed","peerStateAtTime":{"status":"idle"}}
{"ts":"2026-05-01T06:54:50.060Z","side":"inside","from":"idle","to":"stopping","reason":"stop requested","peerStateAtTime":{"status":"idle"}}
```

Compare to FX002-1's evidence (same prompt, default schema): `state/` directory empty, every transition rejected. **Fix confirmed working.**

### Other observations
- Farewell envelope written + system validation passed (`validated: true, validationErrors: []`).
- No `state does not match inside state schema` errors anywhere in `events.ndjson`.
- The companion's own `magicWand` from this run independently flagged the same `run.json counters.messages: 0` debt I noted from FX002-1's investigation. Filed as MW4 in the parent plan's deferred-follow-ups section.

### Acceptance — closed

- [x] Demo briefing → visible state transitions + threaded `progress` reply ✓
- [x] `doctor` flags drift before fix; clears after ✓
- [x] Soft-fail preamble in place ✓
- [x] `just fft` green ✓

**FX002 complete.**

---

## Full demo verification (2026-05-01)

Run `2026-05-01T17-43-12-943Z-0eee` — full 8-step walkthrough exercising every primitive in `workshops/001-companion-demo.md`. Headless: I drove both the operator side and observed the companion side from this terminal.

### Steps and outcomes

| Step | Action | Outcome |
|---|---|---|
| 1 | Boot companion | TUI mounts, state idle, polling on `wait_for_any` |
| 2 | Send briefing | ack + threaded `progress` greeting (`ackOf` set) |
| 3 | Send Round 1 task | (See "Foot-gun A" below; companion picked up a later "test" message instead) — finding + threaded question, state → blocked |
| 4 | Answer question via `--ack-of` | summary reply, state `blocked → reporting → idle` |
| 5 | Flip outside state | companion sent `progress` row noting the flip — peer-state listening confirmed |
| 6 | Directive | ack + `progress` "Scope narrowed" (no state change beyond the brief flicker) |
| 7 | Send Round 2 task | terse single `finding`, no follow-up question — directive respected |
| 8 | `control:stop` | farewell envelope written; state `idle → stopping`; run completed; auto-validated |

### Inside inbox tally (by type)

| type | count |
|---|---|
| ack | 7 |
| progress | 3 |
| finding | 3 |
| question | 1 |
| summary | 1 |
| farewell | 1 |

### State transitions captured (`state/history.ndjson`)

13 transitions across both sides:
- 12 inside (`idle → reading → reporting → idle → reading → reporting → blocked → reporting → idle → reading → reporting → idle → stopping`)
- 1 outside (`idle → in-progress` from my Step 5)

All persistence working correctly post-FX002-2 schema fix. **The Path C fix is confirmed end-to-end across all four state values the prompt uses.**

### Foot-guns surfaced during the demo (NOT FX002 bugs — discovered during verification, filed separately)

**Foot-gun A — `wait_for_any` skips pre-existing unread inbox messages.** When TASK1 arrived during a window when the companion was idle-budget'd between polls, it sat in the inbox unprocessed. Even when "test" arrived later and woke `wait_for_any`, the wake event included only "test" — TASK1 was orphaned until the companion's pre-farewell drain check picked it up.

The companion's own farewell magicWand independently flagged this:
> "Add a wait_for_any diagnostic mode or returned high-water mark that shows when matching inbox messages are skipped or already pending, so companions can detect delivery/order drift before the final unresolved-request check."

Filed as **MW6** in the parent plan.

**Foot-gun B — `inside inbox list --after <id>` returns empty when the id isn't in the lane being listed.** Cross-lane ids (e.g. passing an outside-message id as `--after` when listing inside) silently return `[]` without warning. The natural operator mental model is "wait for replies newer than this outside message I sent" — that doesn't work. Operators must instead capture the last INSIDE-lane id as a watermark before sending, then `--after` that.

This is exactly the kind of trap FX003 (the `--wait`/`--after` how-to) needs to surface. Note added to FX003's scope. Filed as **MW5** in the parent plan.

These foot-guns don't break FX002 — they break the demo *operator* experience in subtle ways. FX003 + the magicWands target them.
