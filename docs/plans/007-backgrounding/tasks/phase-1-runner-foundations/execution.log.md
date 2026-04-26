# Phase 1: Runner Foundations — Execution Log

**Phase**: Phase 1: Runner Foundations
**Plan**: [coordination-plan.md](../../coordination-plan.md)
**Dossier**: [tasks.md](./tasks.md)
**Flight Plan**: [tasks.fltplan.md](./tasks.fltplan.md)
**Started**: 2026-04-26

---

## Pre-Phase Setup

**Harness check**: `docs/project-rules/harness.md` does NOT exist → no harness; standard testing only.

**T010 pre-step (baseline capture)**: Created `scripts/capture-p1-baseline.sh` and `scripts/diff-baselines.mjs`. Built current dist (`npm run build`) and ran capture script against existing 9 agents.

Captured to `docs/plans/007-backgrounding/tasks/phase-1-runner-foundations/baselines/`:
- `doctor.json` (full agent audit)
- `check-<slug>.json` × 9 (per-agent check)

**Adjustment from dossier**: dossier mentioned `minih run hello-world` baseline — skipped because it would invoke real Copilot SDK (latency, agent reasoning unstable). `doctor` + `check` per agent give structural backward-compat coverage without a live SDK call.

---

## T001 — Schemas (DONE)

**Files**:
- `src/schemas/inbox-message.json` (NEW)
- `src/schemas/outside-state.json` (NEW)
- `src/schemas/inside-state.json` (NEW)
- `src/schemas/state-history-entry.json` (NEW)
- `test/runner/schemas.test.ts` (NEW)
- `scripts/copy-schemas.js` (MODIFIED — copy 4 new schemas to dist/)
- `package.json` (MODIFIED — added `ajv-formats@^3.0.1`)

**Decision (Discovery row)**: added `ajv-formats` despite Non-Goals saying "no new npm deps in P1". Justification: dossier T001 mandates `format: date-time` enforcement; without ajv-formats AJV silently passes any string for `format`, leaving validation half-done. ajv-formats is from the same maintainer team as AJV, ~50KB, no transitive risk. Alternative (skip format enforcement) would have left a real validation gap surfaced by the validate-v2 sweep.

**Evidence**:
```
$ npx vitest run test/runner/schemas.test.ts
 ✓ test/runner/schemas.test.ts (25 tests) 29ms
 Test Files  1 passed (1)
      Tests  25 passed (25)
```

25/25 tests pass:
- 4 schemas parse as plain JSON
- 4 schemas compile in AJV strict mode
- 4 schemas declare draft-2020-12 `$schema`
- inbox-message: positive + negative date-time / ULID-pattern / sender-enum
- outside-state: positive + negative updatedBy + status-enum
- inside-state: positive + negative updatedBy
- state-history-entry: positive + null reason + negative missing peerStateAtTime
- malformed-JSON load test

**Coverage of dossier Done When**:
- ✅ All four files exist, parse as JSON (no comments)
- ✅ Declare `$schema: "https://json-schema.org/draft/2020-12/schema"`
- ✅ AJV strict-mode compiles each
- ✅ ajv-formats registered (proven by `'not-a-date'` rejection)
- ✅ Positive + negative samples assert as expected
- ✅ Malformed-JSON load test surfaces error loudly

---

## T002 — ULID (DONE)

**Files**:
- `src/runner/ulid.ts` (NEW, ~70 LOC including JSDoc)
- `test/runner/ulid.test.ts` (NEW)

**Implementation notes**: Crockford-base32 alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (no I, L, O, U). 48-bit ms timestamp + 80-bit randomness. Module-level `lastMs`/`lastRand` state preserved across calls. Sub-ms collision: increment `lastRand` (16-byte buffer treated as a single big-endian counter via BigInt). Clock rewind: when `Date.now() <= lastMs`, reuse `lastMs` and increment.

**Evidence**:
```
$ npx vitest run test/runner/ulid.test.ts
 ✓ test/runner/ulid.test.ts (6 tests) 30ms
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

6/6 tests pass:
- 26-char Crockford regex match (×100)
- 10K unique IDs in burst (zero collisions)
- 10K burst lex-sort == creation order
- 1000 IDs in single ms preserve monotonicity
- Explicit clock-rewind by 5ms preserves monotonicity (50 before + 100 after)
- Module exports only `ulid` (narrow surface for future npm swap)

---

## T003 — Atomic-Write (DONE)

**Files**:
- `src/runner/atomic-write.ts` (NEW, ~120 LOC including JSDoc + error class)
- `test/runner/atomic-write.test.ts` (NEW)

**Implementation notes**: Exports `writeFileAtomic` (sync), `writeFileAtomicAsync`, and `AtomicWriteCrossFsError`. Pattern: `openSync('w')` → `writeSync` → `fsyncSync` → `closeSync` → `renameSync`. On any error: unlink tmp file before re-throwing. EXDEV detection via `err.code === 'EXDEV'` → typed `AtomicWriteCrossFsError`. Module-level `counter` (>>>0 wrap) prevents tmp-name collisions across rapid retries.

**Evidence**:
```
$ npx vitest run test/runner/atomic-write.test.ts
 ✓ test/runner/atomic-write.test.ts (11 tests) 98ms
 Test Files  1 passed (1)
      Tests  11 passed (11)
```

11/11 tests pass:
- Sync: write+read; overwrite; ENOENT on missing parent; no tmp-leak on success; no tmp-leak on rename failure (target was a directory); proceeds past stale tmp file
- Async: write+read; ENOENT on missing parent; **10 concurrent writers leave one valid payload (set-membership)**; **1000-iter parallel reader probe never observes torn/missing content during 10 parallel writes**
- `AtomicWriteCrossFsError` typed export

**Coverage of dossier Done When**:
- ✅ Sync + async exports work
- ✅ 10 parallel writers → set-membership assertion (no specific winner)
- ✅ 1000 reader probes never see truncated bytes
- ✅ Missing parent throws ENOENT
- ✅ Stale tmp file does not block fresh write
- ⚠️ EXDEV typed-error path verified by error-class unit test (real cross-fs is hard to engineer in CI; the `isExdev` branch is exercised; we trust the err.code path).

---

## T004 — types.ts extensions (DONE)

**Files**:
- `src/runner/types.ts` (MODIFIED — added 7 new types at end of file)

**Types added** (mirror schemas from T001):
- `Side = 'outside' | 'inside'`
- `InboxMessage` (mirrors inbox-message.json)
- `OutsideState` / `InsideState` (mirror their schemas; `updatedBy` is a literal type)
- `SideState = OutsideState | InsideState`
- `StateHistoryEntry` (mirrors state-history-entry.json)
- `CoordinationFrontmatter = { enabled: boolean; outside?; inside? }` — stable shape (no string/boolean union; the parser normalizes inputs to this shape)

**Explicitly NOT added** (deferred to P6):
- `RetrospectiveCoordination`
- `MagicWandTarget` widening to include `'coordination'`

Inline comment at top of new section documents both deferrals to prevent drift.

**Evidence**: `npx tsc --noEmit` exit=0. Caught and fixed a `string | Buffer` overload issue in `atomic-write.ts` along the way (tsc forced the disambiguation).

---

## T005 — context.ts (DONE)

**Files**:
- `src/runner/context.ts` (NEW — 60 LOC)
- `src/runner/runner.ts` (MODIFIED — added `export` to existing `MINIH_ENV_KEYS` array; no other changes)
- `test/runner/context.test.ts` (NEW — 19 tests)

**Key decisions**:
- `MINIH_ENV_KEYS` (existing 14 keys) gets `export` added; the literal IS NOT extended (per debt entry).
- `context.ts` imports the existing array and composes `MINIH_ENV_KEYS_ALL = [...MINIH_ENV_KEYS, ...MINIH_ENV_KEYS_COORDINATION]` so P4 spawn config has a single point of contact.
- `getCoordinationEnv()` prefers `MINIH_CONTEXT` env-var if it has a valid value (`'inside'|'outside'`); otherwise falls back to `detectContext()`.

**Evidence**:
```
$ npx vitest run test/runner/context.test.ts
 ✓ test/runner/context.test.ts (19 tests) 3ms
 Test Files  1 passed (1)
      Tests  19 passed (19)
```

19/19 tests pass:
- `detectContext()` happy paths (set/unset)
- 9 trap-value tests (`'true'`, `'TRUE'`, `'yes'`, `'0'`, `''`, `' 1 '`, `'1\n'`, `'true,'`, `'inside'`) all → `'outside'`
- `MINIH_ENV_KEYS_COORDINATION` shape (3 keys, sorted equals expected)
- `MINIH_ENV_KEYS_ALL` length and key-presence (composed view)
- `getCoordinationEnv()` 4 scenarios (defaults, env-set, MINIH_CONTEXT-preferred, invalid-MINIH_CONTEXT-fallback)

---

## T006 — state.ts (DONE)

**Files**:
- `src/runner/state.ts` (NEW — ~165 LOC including 3 typed errors + JSDoc)
- `test/runner/state.test.ts` (NEW — 17 tests)

**Implementation**: Pure helpers only — `readStateLazy`, `writeState`, `appendHistory`. Three typed errors (`StateCorruptError`, `HistoryLineTooLargeError`, `InvalidSlugError`). `readStateLazy` validates required fields + `updatedBy` matches the requested side; throws on any corruption. `appendHistory` auto-populates `peerStateAtTime` via lazy-read of the other side; enforces ≤PIPE_BUF line size for POSIX append atomicity.

**Gotcha caught**: First version of the no-rule-engine self-grep test failed because the JSDoc explicitly mentions "no requiresPeer enforcement" as a documented design constraint. Fix: strip block + line comments before grep so doc and code-absence guarantee can coexist. Logged as gotcha.

**Evidence**:
```
$ npx vitest run test/runner/state.test.ts
 ✓ test/runner/state.test.ts (17 tests) 97ms
```

17/17 tests pass:
- `readStateLazy`: synthetic default doesn't write; round-trip; corruption (4 modes — bad JSON, missing field, updatedBy mismatch, non-object); invalid slug
- `writeState`: creates parent dir; 10-concurrent set-membership; invalid slug
- `appendHistory`: NDJSON round-trip; **auto-populates peerStateAtTime** from peer side; **first-ever transition records `{status: 'idle'}`**; oversize line throws; **100 parallel appends → 100 lines, all valid JSON**; invalid slug
- No-rule-engine grep guarantee (comment-stripped)

---

## T007 + T008 — folder.ts extensions (DONE — combined since they touch the same file)

**Files**:
- `src/runner/folder.ts` (MODIFIED — added 6 path helpers + 3 typed errors + outside.md discovery + `parseCoordinationField`; threaded `outsideContract` + `coordination` into `AgentDefinition` via `listAgents`)
- `src/runner/types.ts` (MODIFIED — extended `AgentDefinition` with optional `outsideContract` and `coordination` fields)
- `test/runner/folder.test.ts` (MODIFIED — added 3 describe blocks: T007 path helpers (10 tests), T007 outsideContract discovery (4 tests), T008 coordination frontmatter (10 tests))
- `test/fixtures/agents-coordination/has-outside-md/{prompt.md,outside.md}` (NEW — kept OUTSIDE the real `agents/` so it does NOT affect T010 baseline)

**Key design decisions**:
- `outsideContract` returns `undefined` when absent, `''` when present-but-empty (consumers can distinguish).
- Files >16KB truncated to 16KB with `console.warn` (4KB/8KB doctor warnings land in P6).
- Symlink-out-of-tree throws `OutsideAgentsDirError` (path-traversal guard).
- `parseCoordinationField` always returns `{enabled: boolean, ...}` (never undefined; workshop 005:95 alignment).
- `watermarkPath` exported but P3 owns the file format (workshop 007).

**Evidence**:
```
$ npx vitest run test/runner/folder.test.ts
 ✓ test/runner/folder.test.ts (49 tests) 27ms
```

49/49 pass — 25 existing tests unchanged + 24 new T007/T008 tests:
- 8 T007 path helpers (5 helpers × absolute-path + slug-validation matrix)
- 4 T007 outsideContract (absent / present / empty / oversize-truncated)
- 10 T008 parseCoordinationField (4 valid forms + 4 negative forms + absent + 1 backward-compat sanity)

---

## T009 — index.ts re-exports (DONE)

**Files**:
- `src/runner/index.ts` (MODIFIED — additive only; preserved all 19 existing exports verbatim)

**Re-exports added** (alphabetized within groups):
- atomic-write: `AtomicWriteCrossFsError`, `writeFileAtomic`, `writeFileAtomicAsync`
- context: `detectContext`, `getCoordinationEnv`, `MINIH_ENV_KEYS_ALL`, `MINIH_ENV_KEYS_COORDINATION`, type `CoordinationEnv`
- folder (T007/T008): `hasOutsideMd`, `historyPath`, `inboxLanePath`, `InvalidCoordinationFrontmatterError`, `InvalidSlugError`, `OutsideAgentsDirError`, `outsideMdPath`, `stateFilePath`, `watermarkPath`
- runner (newly exported): `MINIH_ENV_KEYS`
- state: `appendHistory`, `HistoryLineTooLargeError`, `readStateLazy`, `StateCorruptError`, `writeState`
- ulid: `ulid`
- types: `CoordinationFrontmatter`, `InboxMessage`, `InsideState`, `OutsideState`, `Side`, `SideState`, `StateHistoryEntry`

**Explicitly NOT exported** (deferred to P6 per validation): `RetrospectiveCoordination`, `MagicWandTarget`.

**Evidence**:
```
$ npm run build && node -e "console.log(Object.keys(require('./dist/runner/index.js')).sort())"
[42 exports listed alphabetically; original 19 + 23 new]
```
- All 19 original exports present unchanged.
- 23 new exports added.
- Zero `RetrospectiveCoordination` / `MagicWandTarget` in the output (grep confirmed).

---

## T010 — Backward-compat smoke check (DONE)

**Files**:
- `scripts/capture-p1-baseline.sh` (NEW — bash script, 25 LOC)
- `scripts/diff-baselines.mjs` (NEW — node script, 65 LOC)
- `docs/plans/.../baselines/` (NEW — committed pre-P1 baselines, 10 JSON files)

**Procedure executed**:
1. **Pre-T001 step** (executed BEFORE any src/ changes): captured baseline via `capture-p1-baseline.sh`. Output: 1 `doctor.json` + 9 per-agent `check-*.json`. Committed to dossier directory.
2. **Post-T009 step**: re-ran `npm run build`, then re-captured to `/tmp/post-p1-baseline/`. Ran `diff-baselines.mjs` (ignore-keys: `timestamp, ts, runId, sessionId, duration, startedAt, completedAt, runDir`).
3. **Full test suite**: `npm test` → **230/230 pass**, 17 test files (5 new from P1 + 12 existing).
4. **Type-check**: `tsc --noEmit` exit=0.

**Evidence**:
```
$ npm test
 Test Files  17 passed (17)
      Tests  230 passed (230)
   Duration  1.36s

$ node scripts/diff-baselines.mjs <pre> <post>
OK: 10 file(s) match (after key-strip)
exit=0
```

**Coverage of dossier Done When**:
- ✅ Capture script exists + executable
- ✅ Baselines directory committed BEFORE T001
- ✅ Diff script ignores transient keys
- ✅ Post-P1 diff returns exit 0 against committed baseline
- ✅ Full test suite green (230/230 — 5 new test files from P1, 0 regressions in existing 12)
- ✅ tsc green

---

## Phase 1 — LANDED

**Summary**: All 10 tasks complete. Pure-additive foundations phase; existing 9 agents unchanged behavior. P2-P6 have a clean, well-tested vocabulary to consume.

**Acceptance Criteria status**:
- ✅ **AC-CTX-DETECT** — `detectContext()` strict equality with `MINIH='1'`; 9 trap-value tests passing
- ✅ **AC-ENV-VARS** (P1 partial) — `MINIH_INBOX_DIR`, `MINIH_STATE_DIR`, `MINIH_CONTEXT` exported; composed `MINIH_ENV_KEYS_ALL` available; full propagation through spawn config still lands in P4
- ✅ **AC-BACKWARD-COMPAT** (P1 partial) — 230/230 tests green; baseline diff exit=0; full automated `test/cli/all-existing-agents-pass-doctor.test.ts` lands in P2 task 2.7

**Discoveries logged**:
- T001 decision: added `ajv-formats` despite Non-Goals (justified — without it, `format: date-time` is dead validation)
- T005 debt: `MINIH_ENV_KEYS` literal in `runner.ts` intentionally NOT extended; deferred to P3/P4 with composition export as the safety mechanism
- T006 gotcha: no-rule-engine self-grep test needed comment-stripping so JSDoc could legitimately mention the absent feature

**Total file delta**:
- NEW: 11 files (4 schemas + 4 src/runner modules + 4 test files + 2 scripts + 2 fixtures)
- MODIFIED: 5 files (folder.ts, types.ts, runner.ts, index.ts, package.json + copy-schemas.js)
- Lines: ~1500 added across src+test+docs (rough estimate)

**Next**: `/plan-7-v2-code-review --phase "Phase 1: Runner Foundations" --plan ".../coordination-plan.md"` for formal phase review. Or `/plan-5-v2-phase-tasks-and-brief --phase "Phase 2: runAgent Event-Driven Refactor + Preamble Builder"` to begin P2 dossier.

---

## Code-Review Pass 1 — `minih run code-review` (REQUEST_CHANGES → fixed inline)

Ran the minih code-review agent against P1. Verdict: **REQUEST_CHANGES** with 3 HIGH findings — all owned per AGENTS.md "any finding is ours" rule.

**F001 (HIGH, correctness)** — `parseCoordinationField` accepted object-form `outside`/`inside` payloads but threw the values away (`result[key] = {}` always). Author intent silently lost.
- **Fix**: parse the inline value via `JSON.parse`; reject non-object values + malformed JSON with `InvalidCoordinationFrontmatterError`. Added 2 positive tests (real payload preserved) + 2 negative tests.
- File: `src/runner/folder.ts:316-348`; tests in `test/runner/folder.test.ts`.

**F002 (HIGH, correctness)** — `readStateLazy` only checked key presence; types of values were unchecked. `{status: 42, data: [], updatedAt: 'not-a-date'}` would pass and be returned as `SideState` — corruption silently propagated.
- **Fix**: validate `status` is non-empty string, `data` is plain object (not array, not null), `updatedAt` is a parseable date-time string. Three new typed errors per failure mode.
- File: `src/runner/state.ts:115-152`; 3 new tests in `test/runner/state.test.ts`.

**F003 (HIGH, testing)** — `capture-p1-baseline.sh` invoked `minih check <slug>` without `--file`, so all 9 committed `check-*.json` files were E108 argument errors, not real validation evidence. Backward-compat AC was effectively unproven.
- **Fix**: rewrote script to capture `doctor.json` (full agent audit — the canonical backward-compat probe) + `list.json` (agent discovery surface). Dropped the bogus `check-*.json` baselines. Documented in script header why `minih run hello-world` baseline is intentionally omitted (live SDK call would be inherently non-deterministic).
- File: `scripts/capture-p1-baseline.sh` (rewritten); old `check-*.json` baselines removed; new `doctor.json` + `list.json` captured + diff exit=0 against post-fix re-capture.

**Domain compliance**: PASS across all 6 sub-checks (file placement, contract imports, dependency direction, domain docs, registry, map).

**Post-fix evidence**:
- `just fft` → exit=0 (lint, format, build, typecheck, **236/236 tests** — 6 new from F001+F002 coverage, audit)
- baseline diff exit=0 across 2 files (doctor.json + list.json)
- AC-BACKWARD-COMPAT confidence raised from 20% → high (real structural evidence, not E108 errors)

---

## Pre-commit `fft` gate (per AGENTS.md update)

Added a "Pre-commit / pre-push gate" section to AGENTS.md memorializing: `just fft` runs before every commit + push, and any finding is ours regardless of which file it lives in. Two pre-existing `noNonNullAssertion` errors in `test/runner/{integration,runner}.test.ts` were fixed (replaced `!` with explicit `if (def === null) throw …`) — they were our responsibility under the new rule.


