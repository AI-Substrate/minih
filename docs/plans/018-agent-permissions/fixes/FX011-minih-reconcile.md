# FX011 — `minih reconcile` — opt-in run.json healer

**Created**: 2026-05-04
**Status**: PROPOSED — DEFERRED (sister fix to FX009; healing surface split out)
**Plan**: 018-agent-permissions
**Source**: GitHub issue [#24](https://github.com/AI-Substrate/minih/issues/24); split out from FX009 per Chainglass agent's preference 2026-05-04 ("Read-only is enough. Strong preference for option (a)... If you want the file healed too, option (c) — read-only `status` + a separate `minih reconcile` — is the cleanest split").
**Domain(s)**: cli (new command), runner (re-export `isProcessAliveDefault`)

---

## Problem

After FX009, `minih status` returns `verdict: 'dead'` for runs whose pid has exited but does NOT update `run.json.status` from `'active'` to `'crashed'`. This keeps the read command pure — important for concurrency safety — but leaves the underlying file lying to anyone who reads it directly (or to future tooling that walks `runs/*/run.json`).

The dogfood rule discourages reading `run.json` directly, but the rule isn't a guarantee. Tools that grep/walk run dirs (CI pipelines, retros, third-party visualizers, future minih commands) will see a `run.json.status: 'active'` for a dead run and either (a) wait fruitlessly, (b) try to send messages into a void, or (c) miscount active workloads.

We need a way to heal `run.json` deterministically — but NOT inside `status`, where it would introduce concurrent-writer races (two simultaneous `status` calls each detect dead and try to write).

## Proposed Fix

`minih reconcile [<slug>] [--all] [--dry-run]` — opt-in idempotent healer. Walks the run-folder structure looking for `run.json.status === 'active'` whose recorded pid has exited; rewrites those files atomically with `status: 'crashed'` + `terminalReason: 'pid-vanished'` + `exitDetectedAt: <now>`. Emits a summary table of healed runs. Safe to run from cron, pre-commit hooks, or after a system restart.

**Single-writer-per-rundir semantics** — guaranteed by:
1. Per-run-dir `.minih-reconcile.lock` file held during the read-modify-write cycle.
2. Atomic rename pattern (`run.json.tmp-<pid>` → `run.json`) — same as the rest of minih's run.json mutations.
3. `--dry-run` mode never writes.

Concurrent invocations of `minih reconcile` either skip locked rundirs (if `--skip-locked`, default) or wait briefly (if `--wait-locks`). Default behaviour: skip and report — first reconcile pass heals what it can; second pass picks up anything skipped. Always converges.

## Scope

### CLI surface

```bash
# Reconcile one slug
minih reconcile <slug>

# Reconcile all slugs
minih reconcile --all

# Preview without writing
minih reconcile <slug> --dry-run

# Concurrency behaviour
minih reconcile --all --skip-locked   # default
minih reconcile --all --wait-locks --wait-timeout 30
```

### Output (JSON envelope)

```json
{
  "status": "ok",
  "data": {
    "scanned": 12,
    "healed": 3,
    "alreadyClean": 8,
    "skipped": 1,
    "skippedReasons": [{"runId": "...", "reason": "locked-by-other-process"}],
    "details": [
      {
        "slug": "code-review-companion",
        "runId": "2026-05-04T15-57-06-931Z-0a24",
        "pidBefore": 55547,
        "pidAliveAfterProbe": false,
        "previousStatus": "active",
        "newStatus": "crashed",
        "terminalReason": "pid-vanished",
        "exitDetectedAt": "2026-05-04T07:00:00Z"
      }
    ]
  }
}
```

### TTY display

Single-line summary per healed run; final tally:

```
✓ code-review-companion / 2026-05-04T15-57-06-931Z-0a24 — pid 55547 vanished
✓ build-bot / 2026-05-04T14-23-11-001Z-1234 — pid 49823 vanished
- doctor-companion / 2026-05-04T16-00-00-000Z-5678 — already clean
✗ data-pipeline / 2026-05-04T17-22-00-000Z-9999 — locked by another process

3 healed, 8 already clean, 1 skipped
```

### Run.json mutation contract

`status: 'active'` → `status: 'crashed'` (NEW value in the union — additive; existing readers tolerate unknown).

**LiveRunStatus full union** (current at `src/runner/types.ts:304-311`): `'starting' | 'active' | 'idle' | 'completing' | 'completed' | 'failed' | 'stale'`. After FX011 adds `'crashed'` the union widens to 8 values. Reconcile only acts on rows with `status === 'active'`; rows with `'starting'` / `'idle'` / `'completing'` / `'stale'` are skipped (already past or not-yet-active). Existing readers that switch on `('active', 'completed', 'failed', 'starting', 'idle', 'completing', 'stale')` continue to work as long as the default branch handles `'crashed'` (additive).

Add fields:
- `terminalReason` — see preservation rules below
- `exitDetectedAt: '<ISO 8601>'`
- `reconciledBy: '<minih version>'`
- `pidVanishedAt: <best-effort estimate from events.ndjson last mtime, OR ABSENT>`

**`terminalReason` preservation invariant** (cross-FX integration): If `run.json.terminalReason` is already set (non-null, non-empty string) BEFORE reconcile runs, **preserve the existing value** — do NOT overwrite. Only write `terminalReason: 'pid-vanished'` when the field is absent or empty. This protects the diagnostic surface FX012 establishes (`'provider-stream-aborted'`) and any future cause-of-death string that another path might write before the pid actually vanishes.

**`pidVanishedAt` fallback rule**:
- If `eventsPath` exists AND its file size > 0 → `pidVanishedAt = fs.statSync(eventsPath).mtime.toISOString()`.
- Otherwise → field is **absent** from the healed `run.json` (NOT `null`, omitted entirely).
- Consumers MUST treat `pidVanishedAt` as optional. AC-FX11.10 anchors this.

Bump `updatedAt` to current timestamp; preserve all other fields.

### Detection logic

For each `runs/<runId>/run.json`:

1. Read & parse. If missing → silent skip (run dir without run.json is normal during init). If malformed (parse error) → add to `skippedReasons` with `reason: 'malformed-run-json'` AND emit stderr warning matching `^\[minih\] Warning: skipping <runDir>: malformed run.json`.
2. If `run.json.status !== 'active'` → skip ("already clean"). The `'active'` filter excludes `'starting'`, `'idle'`, `'completing'`, `'completed'`, `'failed'`, `'stale'`, `'crashed'` (already-reconciled).
3. If `runs/<runId>/completed.json` exists → skip ("completed; status mismatch is a separate bug, log warning").
4. If `run.json.pid` is missing OR `pid <= 0` → skip with `reason: 'no-pid-recorded'` ("no usable pid recorded; can't probe").
5. Probe `isProcessAliveDefault(run.json.pid)`. If alive → skip ("genuinely active").
6. Acquire `<runDir>/.minih-reconcile.lock`. If locked → skip with reason `locked-by-other-process` (or wait if `--wait-locks`).
7. Re-read `run.json` (TOCTOU guard — another process may have updated it between the initial read and the lock acquisition).
8. Re-check (3)/(4)/(5) under lock. If any condition flipped, release lock and skip with reason `state-changed-under-lock`.
9. **Determine `terminalReason` for the heal** — read existing `run.json.terminalReason`; if non-null and non-empty, preserve it; otherwise use `'pid-vanished'`. Determine `pidVanishedAt` per fallback rule. Write `run.json.tmp-<pid>` with healed content. Rename to `run.json` (atomic on POSIX). **If write or rename throws** (e.g., read-only filesystem, ENOSPC, EACCES) → release lock and add to `skippedReasons` with `reason: 'write-failed'` + optional `error: <stringified cause>` field; continue processing remaining runs.
10. Release lock. Emit detail record (preserving `terminalReason` source flag — `'preserved'` or `'pid-vanished'` for telemetry visibility).

**Skip reason closed enum** (canonical):
```
'locked-by-other-process'      // lock currently held by another reconciler
'lock-wait-timeout'            // --wait-locks enabled, timeout elapsed before acquiring
'state-changed-under-lock'     // TOCTOU: state flipped between initial check and lock acquisition
'no-pid-recorded'              // run.json missing pid, or pid <= 0 (cannot probe)
'malformed-run-json'           // JSON parse error
'write-failed'                 // tmp-write or rename threw (with optional `error` detail)
```

Consumers MUST tolerate unknown reason values (additive enum).

### `--wait-locks` behavior

When `--wait-locks` is set:
- Try to acquire the lock; if held, poll every 100 ms for up to `--wait-timeout` seconds (default 30).
- On successful acquisition within the window → continue normally with steps 7-10.
- On timeout → add to `skippedReasons` with `reason: 'lock-wait-timeout'`; processing continues with the next run.
- The command still exits 0 unless `--fail-on-skip` is specified (NOT in scope v1; future enhancement).

### Lock file semantics

`<runDir>/.minih-reconcile.lock` contains:
```json
{"pid": <reconciler pid>, "ts": "<ISO>", "ttl": 30}
```

Acquired with `O_CREAT | O_EXCL`. On read of an existing lock: if `ttl` elapsed past `ts`, treat as stale and steal (atomic write). Otherwise honor the lock.

### `--all` discovery

Walks `agents/*/runs/*/run.json` from the project's `agentsDir`. Bounded depth (one level of agents, one level of runs). Streams results — does not load all run.json files into memory at once.

**Sort order** (deterministic across platforms): the walker sorts discovered runs by **slug name (string locale compare, ascending)** then **runId (string sort, ascending — ISO timestamps are lexicographically sortable)** before yielding. This is a single in-memory sort over the slug list, then a per-slug in-memory sort over runIds — no platform-dependent `readdir` ordering leaks into the output.

## Domain Impact

| Domain | Relationship | What Changes |
|--------|-------------|-------------|
| `cli/commands/reconcile` | NEW command | New file: `src/cli/commands/reconcile.ts` |
| `runner` | re-uses existing exports | `isProcessAliveDefault`, `coordinationRunLocation`, JSON envelope helpers — all already exported |
| `cli` index | wires command into commander | `src/cli/index.ts` — new `.command('reconcile')` block |

**Domain contract change**: `run.json.status` union widens — `'active' | 'completed' | 'failed' | 'crashed'` (new `'crashed'`). Documented in CHANGELOG.

## Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [ ] | FX011-1 | Implement `reconcileRun(runDir, options)` core helper. | runner OR cli/utils | `src/runner/reconcile.ts` (new) | Pure-ish: takes runDir, options (incl. `dryRun`, `now()`, `isProcessAlive` injectable, `acquireLock` injectable); returns `ReconcileResult` discriminated union (`'healed'` / `'already-clean'` / `'skipped'` with reason / `'write-failed'` with error). No CLI concerns. **`terminalReason` preservation logic**: if existing `run.json.terminalReason` is non-null and non-empty, preserve as-is; only write `'pid-vanished'` when field is absent. **`pidVanishedAt` fallback**: read events.ndjson mtime if file exists and is non-empty; otherwise omit field entirely. | Domain placement: lives in runner (it's a runner-state operation), exported via index.ts |
| [ ] | FX011-2 | Lock file helper. | runner | `src/runner/reconcile-lock.ts` (new) | `acquireLock(runDir, ttlMs)` returns a release callback OR null if locked; uses `fs.openSync` with `O_CREAT \| O_EXCL`; stale lock detection via embedded ts; injectable clock for test | Pattern matches existing `resume-lock.ts` |
| [ ] | FX011-3 | Implement `minih reconcile` command. | cli | `src/cli/commands/reconcile.ts` (new), `src/cli/index.ts` | Parses `<slug?>`, `--all`, `--dry-run`, `--skip-locked` (default true), `--wait-locks`, `--wait-timeout`; calls `reconcileRun` per discovered run; aggregates results; emits JSON envelope to stdout + TTY summary to stderr | Reuse `formatSuccess` / `formatError` / `exitWithEnvelope` from `src/cli/output.ts` |
| [ ] | FX011-4 | `--all` discovery walker. | cli | `src/cli/commands/reconcile.ts` | `discoverRuns(agentsDir): AsyncGenerator<{slug, runId, runDir}>`; bounded depth; streams; skips non-directories | Use Node's `fs/promises.readdir` with `withFileTypes: true` |
| [ ] | FX011-5 | Unit tests. | cli-tests | `test/cli/reconcile.test.ts` (new) | (a) active+pid-alive → already-clean; (b) active+pid-dead → healed (verify exact JSON shape post-write; `terminalReason: 'pid-vanished'`); **(b2) active+pid-dead+`run.json.terminalReason: 'provider-stream-aborted'` already set → healed BUT terminalReason preserved (NOT overwritten with 'pid-vanished')**; (c) completed → already-clean (no spurious heal); (d) malformed run.json → skipped + stderr warning matches regex `^\[minih\] Warning: skipping`; (e) lock contention → skipped with reason `locked-by-other-process`; (f) dry-run never writes (assert checksum); (g) --all walks multiple slugs **in deterministic slug-then-runId order** (assert against manually constructed expected-order array); **(h) write fails (injected fs.rename throws EACCES) → skipped with reason `write-failed` + `error` field present**; **(i) `--wait-locks --wait-timeout 1` with held lock → skipped with reason `lock-wait-timeout` after ≥1 s**; **(j) active + pid <= 0 → skipped with reason `no-pid-recorded` (probe NOT consulted)**; **(k) events.ndjson absent → healed run.json has NO `pidVanishedAt` field (not null, omitted)** | Mirror `test/runner/run-resolver.test.ts` injection pattern |
| [ ] | FX011-6 | TOCTOU regression test. | cli-tests | `test/cli/reconcile.test.ts` | Inject `acquireLock` that pauses; in the pause window, mutate `run.json` to `status: completed`; assert the lock-then-recheck logic releases the lock without writing AND `skippedReasons[0].reason === 'state-changed-under-lock'` | Workshop 003 § lossless-preservation analogue — never lose data |
| [ ] | FX011-7 | Cross-link from FX009 hint + CHANGELOG. | docs | `docs/how/permissions.md` (if status section exists), `CHANGELOG.md`, FX009 dossier hint | FX009-3 hint string flips from "coming soon" to actual command name; CHANGELOG documents the new command + the `'crashed'` status union extension | Coordinated landing — FX009 may ship first with hint pointing here |

## Workshops Consumed

- None directly. References FX009 (sister fix in this dossier set) for the `isProcessAliveDefault` pattern.

## Acceptance

- **AC-FX11.1**: `minih reconcile <slug>` heals stale-active runs. Exit 0, JSON envelope reports `healed: N`.
- **AC-FX11.2**: `minih reconcile --all` walks all slugs. **Output sorted ascending by slug (locale compare), then ascending by runId (string sort)**; verified by FX011-5 case (g) against manually constructed expected-order array.
- **AC-FX11.3**: `minih reconcile --dry-run` writes NOTHING. Verify with checksum-before/after on every run.json.
- **AC-FX11.4**: Concurrent reconcile invocations are race-safe — at most one writes per run.json.
- **AC-FX11.5**: TOCTOU between read and write is closed — re-check post-lock; abort with `reason: 'state-changed-under-lock'` if state changed (FX011-6 asserts).
- **AC-FX11.6**: Stale lock files (ttl elapsed) are stolen.
- **AC-FX11.7**: `'crashed'` status documented as additive extension; readers that switch on `('starting', 'active', 'idle', 'completing', 'completed', 'failed', 'stale')` continue to work as long as the default branch handles unknown (the new `'crashed'` value).
- **AC-FX11.8**: Output sum invariant — `data.healed + data.alreadyClean + data.skipped === data.scanned`. Plus a TTY-rendering snapshot test against `test/cli/__snapshots__/reconcile.snap` for human-readability assertion.
- **AC-FX11.9** (terminalReason preservation): If `run.json.terminalReason` is already set (non-null, non-empty) on a dead-pid run, `reconcile` preserves the existing value and does NOT overwrite it with `'pid-vanished'`. Demonstrated by FX011-5 case (b2). Protects the diagnostic surface FX012 establishes.
- **AC-FX11.10** (pidVanishedAt fallback): When events.ndjson is absent or zero-size, the healed run.json does NOT contain `pidVanishedAt` (field omitted, NOT `null`). Consumers treat field as optional. Demonstrated by FX011-5 case (k).
- **AC-FX11.11** (skip-reason enum stability): Output `skippedReasons[*].reason` only contains values from the closed enum `'locked-by-other-process' | 'lock-wait-timeout' | 'state-changed-under-lock' | 'no-pid-recorded' | 'malformed-run-json' | 'write-failed'`. Consumers tolerate unknown values (additive). Demonstrated by union assertion across all FX011-5 cases that produce skips.
- **AC-FX11.12** (write failure handling): When the temp-write or rename throws, the run is added to `skippedReasons` with `reason: 'write-failed'` AND an optional stringified `error` field; the command continues processing remaining runs and exits 0 (no `--fail-on-write-error` in scope v1). Demonstrated by FX011-5 case (h).
- **AC-FX11.13** (`--wait-locks` timeout): When `--wait-locks` is set and lock acquisition exceeds `--wait-timeout` seconds (default 30), the run is added to `skippedReasons` with `reason: 'lock-wait-timeout'`; processing continues. Demonstrated by FX011-5 case (i).

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Concurrent writers corrupt `run.json`. | Low (lock + atomic rename). | Test FX011-6 explicitly asserts. Lock file ttl prevents permanent stuck state. |
| `'crashed'` status breaks downstream tooling that switches on the union. | Low — additive change. | CHANGELOG migration note; FX009 already widened `verdict` similarly with `'dead'`. |
| Operators run `reconcile` while a real `minih run` is in flight that just hasn't yet noticed pid death (genuinely-mid-init race). | Very low. | Probe is conservative — `isProcessAliveDefault` returns true on EPERM (assume alive). Only true `ESRCH` (no such process) triggers heal. |
| Lock file leaks if reconciler crashes mid-write. | Medium. | TTL-based stale detection + `--force-unlock` flag (not in initial scope; can add if real-world traction shows up). |
| Discovery walker is slow on huge `runs/` directories (1000+ runs per slug). | Low — current install patterns don't reach that scale. | If it becomes an issue, add `--since <ISO>` filter to scope to recent runs. Out of scope for v1. |

## Out of scope

- **Auto-reconcile during runner boot.** A `minih run` that detects sibling dead runs from prior sessions does NOT heal them — explicit operation only.
- **Healing `events.ndjson` truncation.** FX012 provides observability for truncation; FX011 doesn't try to repair the events stream.
- **GC of old run dirs.** This is housekeeping — separate command (or CRON-driven `minih gc` if we add one).
- **Cross-host reconciliation.** Local-only.
- **Healing `completed.json`-mismatched runs.** If `completed.json` exists alongside `run.json.status === 'active'`, that's a different bug — log warning, don't try to heal.

## Testing approach

- **Unit tests**: `test/cli/reconcile.test.ts` — 7 cases enumerated above + 1 TOCTOU stress test.
- **Integration test**: walk a synthetic `agents/foo/runs/*` tree with a mix of healthy/dead/completed/locked runs; verify aggregate output.
- **Concurrency test**: spawn two `reconcile` invocations against the same dir; assert exactly one heals + one reports `skipped`.

## Dependencies

- **Independent of FX008 / FX010 / FX012**.
- **Cross-link with FX009** — FX009's TTY hint points at `minih reconcile`; coordinate landing so the hint is accurate.

## Discoveries & Learnings

_Populated during implementation by plan-6._

| Date | Task | Type | Discovery | Resolution |
|------|------|------|-----------|------------|

---

## Validation Record (2026-05-04)

| Agent | Lenses Covered | Issues | Verdict |
|-------|---------------|--------|---------|
| Source-Truth (Sonnet 4.6) | Factual Accuracy, Hidden Assumptions | 0 CRIT, 1 HIGH (LiveRunStatus 7 values not 3 — fixed inline), 0 MED, 0 LOW | ⚠️ → ✅ |
| Cross-Reference (Sonnet 4.6) | Integration & Ripple, Hidden Assumptions | 0 CRIT, 1 HIGH (FX011 overwrites FX012 terminalReason — fixed inline), 0 MED, 0 LOW | ⚠️ → ✅ |
| Completeness (Sonnet 4.6) | Edge Cases, Hidden Assumptions, Performance | 0 CRIT, 3 HIGH (TOCTOU skip reason, --wait-locks timeout, write failure path), 3 MED (sort algorithm, malformed-json warning channel, pidVanishedAt fallback) — all fixed inline | ⚠️ → ✅ |
| Forward-Compatibility (Opus 4.7) | Forward-Compatibility, Technical Constraints, Deployment & Ops | 0 CRIT, 0 HIGH (FX011-specific), 0 MED, 0 LOW | ✅ |

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| plan-6 FX011 implementer | testable AC + closed enum of skip reasons + complete failure paths | shape-mismatch | ✅ | 13 testable ACs (AC-FX11.1-13); 11 enumerated test cases (FX011-5 a-k); skip-reason enum locked at 6 values |
| FX012 cross-FX integration | reconcile preserves stream-abort terminalReason | contract-drift | ✅ | AC-FX11.9 + FX011-5 case (b2) — explicit preservation invariant + test |
| FX009 sister-fix landing | hint string targets `minih reconcile <slug>` | shape-mismatch | ✅ | FX009-3 hint is constant; FX011 lands the command itself |
| Issue #24 thread — separate command | preserved | contract-drift | ✅ | FX011 standalone command; status remains read-only |

**Outcome alignment**: FX011 advances *"Safety-by-default for agents; trust ladder for installed packs; credible answer to 'what can this agent do to my machine?'"* by giving operators a deterministic, idempotent recovery path for stale-active runs — the credible-answer surface (verdict from FX009) is paired with a credible-cleanup surface (reconcile heals the file safely) without forcing read commands to mutate state.

**Standalone?**: No — coordinated landing with FX009 + cross-FX with FX012.

### Fixes applied (HIGH)
- ST-4 fixed: LiveRunStatus full 7-value union documented; AC-FX11.7 corrected
- XR-2 fixed: terminalReason preservation invariant; AC-FX11.9 + FX011-5 case (b2)
- COMPL-1 fixed: TOCTOU skip reason `'state-changed-under-lock'` added to closed enum; FX011-6 asserts
- COMPL-2 fixed: `--wait-locks --wait-timeout` behavior specified; AC-FX11.13 + FX011-5 case (i)
- COMPL-3 fixed: write-failure path — `'write-failed'` in skip-reason enum + `error` field; AC-FX11.12 + FX011-5 case (h)

### Fixes applied (MEDIUM)
- COMPL-4 fixed: deterministic sort spec (slug locale-compare → runId string-sort); AC-FX11.2 + FX011-5 case (g)
- COMPL-5 fixed: malformed-run.json warning channel + format; FX011-5 case (d) regex assertion
- COMPL-6 fixed: pidVanishedAt fallback rule (omit when events.ndjson absent); AC-FX11.10 + FX011-5 case (k)

Overall: ⚠️ **VALIDATED WITH FIXES** — 5 HIGH + 3 MED resolved inline; ready for `/plan-6-v2-implement-phase --fix FX011`.
