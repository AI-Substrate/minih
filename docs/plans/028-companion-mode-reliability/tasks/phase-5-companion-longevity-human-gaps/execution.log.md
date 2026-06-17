# Execution Log — Phase 5: Companion longevity through human gaps

**Plan**: [companion-mode-reliability-plan.md](../../companion-mode-reliability-plan.md)
**Mode**: Full · **Scope this run**: 5a only (T001–T004, T007). 5b (T005/T006) is workshop-gated — NOT built.
**Companion**: `--companion` mode (dogfood) — a live `code-review-companion` reviews each commit.

---

## T000 — Harness pre-flight seam (`--event pre-implement`)

- **Router**: installed (`~/.agents/skills/eng-harness-flow`). minih has full harness adoption (CLI 0.3.0, governance `.harness/engineering-harness.md`, `.harness/` substrate, boot = vitest suite).
- **Decision**: `route` → boot validation; engineering zone (S0+S2+S4 hold).
- **Boot verdict (verbatim)**: `harness doctor` = **degraded** — sole failing layer `toolchain: missing tools: biome` (biome resolves via `just fft`/npx, not a standalone binary on PATH); `cli-build` (n/a, consumer install), `extensions` (1 loaded), `instructions`, `record-types` all `ok`.
- **Action**: non-blocking cosmetic flag → **proceed** with standard + survive-gaps testing. Logged, not escalated.

---

## Companion boot (C0/C0a)

- Booted `code-review-companion` in background — runId `2026-06-16T21-31-43-201Z-ce1c`; reached `active` on first poll.
- Briefed once (type=briefing): scope = 5a only, the 5b scope gate, Finding-11 hazards, domain context.
- At brief time peer `verdict: dead` (run 1min old, no `inbox_list` yet) BUT `currentlyRunningTool: view` / `selfReportedState: reading` → **alive** (the exact premature-death false-positive Phase 5 targets). Did not kill.

## Tasks

### T001 (RED) / T002 (GREEN) — opt-in survive-gaps heartbeat

- **New**: `startManifestHeartbeat(runDir, intervalMs?)` in `run-manifest.ts` — `setInterval` → `updateManifest({ updatedAt })` (applyPatch always re-stamps `updatedAt`), `unref`'d, returns a stop fn. Decoupled from `resetStallDeadline` by construction (module has no access to it).
- **Config**: `AgentRunConfig.surviveGaps?: boolean` + `heartbeatIntervalMs?: number` (test seam); `SURVIVE_GAPS_HEARTBEAT_INTERVAL_MS = 20_000` (3× margin under the 60s window).
- **Wiring**: `runner.ts` starts the heartbeat just before the SDK run try-block when `config.surviveGaps`, clears it in the inner `finally` alongside the watchdog/timeout handles (before the terminal manifest writes — `updateManifest` serializes per-runDir so terminal always lands last).
- **Tests** (`companion-longevity.test.ts`, 4): factory advance; (c) cleanup/no-leak; (a) default run does NOT advance updatedAt through a silent gap while survive-gaps does; (b) survive-gaps run still fires `stalled-stream` (heartbeat never resets the watchdog).
- **Evidence**: 4/4 green; `just format` (1 file), `just typecheck` clean; runner-stall + run-manifest suites still green (26 total).

### T003 (RED) / T004 (GREEN) — stallTimeout frontmatter→config leg + survive-gaps profile

- **Parse**: `folder.ts` `parseYamlSimple` now reads `stallTimeout` (mirrors the `timeout` regex; `0` honoured) + `surviveGaps` (boolean); `parseFrontmatter`'s explicit return type + `listAgents` thread both onto `AgentDefinition` (new fields in `types.ts`).
- **Resolve**: `resolveEffectiveBudgets` gains a 4th `definitionStallTimeout?` param → stall precedence is now flag → frontmatter → `DEFAULT_STALL_TIMEOUT_SEC` (`0` honoured via `??`, not collapsed). Callers `run.ts:274` + `resume.ts:623` pass `definition.stallTimeout`.
- **Profile**: both callers set `config.surviveGaps` from `definition.surviveGaps`. The real `agents/code-review-companion/prompt.md` frontmatter now carries `stallTimeout: 0` (watchdog disabled — wall-clock `timeout: 7200` is the backstop) + `surviveGaps: true` (heartbeat on). `idleBudgetMs` (the third ceiling) stays the durable run.json input #49 reads — left for 5b.
- **Tests** (+4 in `companion-longevity.test.ts`): frontmatter parse; `resolveEffectiveBudgets` definition-fallback + flag-wins + default; the real companion frontmatter carries the profile; a survive-gaps profile (stallTimeout 0) times out on wall-clock instead of `stalled-stream`.
- **Evidence**: typecheck clean (caught + fixed `parseFrontmatter`'s return-type annotation); 68 green across companion-longevity + budget-flags + folder.
- **Type gotcha**: `parseFrontmatter` has an explicit return-type annotation (not inferred), so new `parseYamlSimple` fields must be added there too or `listAgents` can't see them.

### T007 (NOTE/DOC) — survival vs engagement

- Added `docs/how/companion-mode.md` § "Surviving long human gaps — the survive-gaps profile": the three killers (staleness/stall/wall-clock) + the profile that addresses each; the heartbeat decoupling; **survival is necessary, not sufficient**; the deferred **`git log`-cursor → `outside inbox send` feeder** as the engagement-half fast-follow (its own small plan); AC-H proves alive, not that a review happened.

## Phase 5a complete

- Domain docs updated: `runner/domain.md` § History (P5 heartbeat + frontmatter fields) and `cli/domain.md` § History (`resolveEffectiveBudgets` 4th param + caller threading).
- **fft-caught hardening (heartbeat write errors)**: the first full `just fft` surfaced 1 unhandled error — a heartbeat write whose atomic rename lost the race against test teardown (`afterEach` rm of tmpDir) was being **re-thrown** via `queueMicrotask`. A best-effort liveness heartbeat must never destabilise the run, so the factory now **swallows** write errors (the next tick retries; the watchdog + wall-clock are the real guards). Re-ran the file 3× clean; full `just fft` green (1426 pass, 16 skip, **0 errors**; the only `audit` output is pre-existing `ws` transitive vulns, non-fatal).
- **Final gate**: `just fft` GREEN. 5a tasks T001–T004 + T007 all `[x]`. 5b (T005/T006) left workshop-gated, NOT built.

## Companion review (dogfood) — findings reconciliation

The live `code-review-companion` reviewed all 4 commits. Verdicts: T001/T002 **APPROVE** (0); T003/T004 **APPROVE_WITH_NOTES** (F001); T007 **APPROVE** (0); P5 wrap **APPROVE_WITH_NOTES** (F002). It confirmed: heartbeat opt-in + isolated, no `resetStallDeadline` access, no `idle-policy.ts` scope creep, `??` honours `stallTimeout: 0`, both callers thread the profile.

| ID | Sev | Finding | Disposition |
|----|-----|---------|-------------|
| **F001** | MEDIUM | Contract drift: plan doc (lines 30/70/71/88) + `budget-flags.test.ts` header still said `stallTimeoutSec`/"wall-clock only" for the frontmatter field, contradicting the shipped `stallTimeout` (config) / `stallTimeoutSec` (budgets) split. | **Fixed inline** — plan-doc frontmatter mentions → `stallTimeout`; test header now names `stallTimeout` frontmatter. |
| **F002** | MEDIUM | Observability: the heartbeat's `catch(() => {})` swallowed *every* `updateManifest` rejection, so a persistently-broken survive-gaps heartbeat would go stale silently. | **Fixed inline** — `startManifestHeartbeat` now logs the first **non-`ENOENT`** failure once to stderr (real fault → operator clue), still ignores `ENOENT` teardown races, still never throws. |

**Dogfood note**: the companion delivered real value — F002 in particular is a genuine quality improvement (silent-failure observability) that the inline review caught before merge. (Earlier in the session I misread the inbox lane and reported "not reviewing"; the companion had in fact acked + reviewed every commit — corrected.)

---

## 5b run (post-workshop) — T005/T006

**Scope**: 5b only (T005 RED, T006 GREEN), after [workshop 003](../../workshops/003-survive-gaps-engagement-and-idle-trigger-seam.md) lifted the gate (Option C). Separate implement run from 5a, same phase.

### Pre-implement harness seam

- 5b is a continuation of Phase 5; the pre-implement seam already fired in the 5a run (T000) with verdict **degraded** (sole failing layer `toolchain: biome` — resolves via `just fft`, non-blocking). The 5b run inherits that posture; no change to the deterministic substrate since, so the verdict is unchanged — proceeded with standard + survive-gaps testing. Not re-escalated.

### Companion boot (C0/C0a)

- Booted a fresh `code-review-companion` — runId `2026-06-17T02-58-06-834Z-77aa`; reached `active` on poll (the prior 5a run had stopped clean → `completed`, so no active run to attach).
- Briefed once (type=briefing): scope = 5b only, the binding workshop-003 contract (typed `surviveGaps`, suppress branch (b), durable `budgets.surviveGaps`, reason map), and the hazards (don't change default behaviour, keep `idle-policy.ts` pure, no wiring, `idleBudgetMs` stays the floor).

### T005 (RED) / T006 (GREEN) — typed survive-gaps idle-policy seam

- **RED**: added a `evaluateIdlePolicy survive-gaps posture` describe block (6 tests) to `companion-longevity.test.ts`: never-spoke + `surviveGaps` continues past the idle budget (the #50 incident); still stands down at the wall-clock backstop (`no_engagement`); spoke-then-idle parallel (`idle_budget`); outstanding-work continue unaffected; **default-unchanged guard** (no `surviveGaps` ⇒ stands down at `idleBudgetMs`, plan-027 #35 preserved); the underscore→hyphen reason-map asserted against `isCleanTerminalReason`. Confirmed RED: exactly the 2 suppress tests failed (12/14 passed) against today's code.
- **GREEN** (workshop 003, Option C): (1) `IdlePolicyInput.surviveGaps?: boolean` (`idle-policy.ts`); (2) `evaluateIdlePolicy` suppresses branch (b) under `!surviveGaps` only — branch (a) backstop + `unresolvedPeerRequests` continue unchanged; fall-through `continue` reason made conditional so a survive-gaps-over-budget continue reads honestly; (3) durable record — `budgets.surviveGaps` added to the manifest `budgets` type (`types.ts`), recorded at run start in `runner.ts` (independent of `coordinationEnabled`), read via new sync `readSurviveGaps` (`run-manifest.ts`, mirrors `readIdleBudgetMs`), exported from `runner/index.ts`. `evaluateIdlePolicy` stays **unwired** — #49 wires the trigger.
- **Purity preserved**: `idle-policy.ts` gains no fs/SDK imports — durability reading lives in `run-manifest.ts`/`runner.ts`.
- **Evidence**: typecheck clean (`tsc --noEmit`); `just fft` green through to sdk-check (`@github/copilot-sdk 1.0.1 latest`); audit = pre-existing transitive vulns only (hono/ws/qs/tar/vitest), non-fatal. Full suite **1432 passed / 16 skipped** (+6 over 5a's 1426 — the new 5b tests).
- **Commits**: `8a42708` (code + tests + workshop 003) — companion-reviewed; `c1a643c` (runner domain.md).

### Companion debrief (dogfood) — 5b

- Briefed → review-request (`8a42708`) → drain ping → `control:stop`. Companion processed all and exited **clean**: `minih status` verdict `completed`, the `minih run` process exited 0.
- Final farewell (`minih companion findings`, the #50-F read-path — NOT the wrong inbox lane): **2 reviewed · 0 findings · 2 summaries** → clean **APPROVE** of 5b. No inline fixes needed (contrast 5a's F001/F002).
- **Live Phase-4 confirmation (again)**: the companion's `control:stop` exit reconciled to `completed`, not `crashed` — exactly the clean-terminal classification Phase 4 built.

### Phase-end harness seam

- 5b closes Phase 5. The phase-end seam (`--event phase-end`, router owns drain-vs-harvest) already fired at the 5a close (T0z) → routed to `--drain` (observe buffer non-empty: DL-001 inbox-read-path + dogfood notes). Those entries remain pending in the buffer; the drain offer stands at the next harness seam. 5b's dogfood was friction-free (clean review, clean stop) — no new blocking observe entry.

## Phase 5 COMPLETE (5a + 5b)

- All Phase-5 tasks `[x]`: T000–T004, T007, T0z (5a) + T005, T006 (5b). The survival half (heartbeat + stallTimeout frontmatter leg + survive-gaps profile) **and** the compose half (typed `surviveGaps` idle-policy seam, durable `budgets.surviveGaps`, unwired for #49) are both landed and companion-reviewed.
- **Survival ≠ engagement** holds: longevity keeps the companion alive to be driven; the `git log`-cursor → `outside inbox send` feeder (the engagement half, Finding 12) remains the documented fast-follow.
- Next: stage 7 review (skippable — a companion reviewed every Phase-5 commit) → stage 8 merge.


