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
