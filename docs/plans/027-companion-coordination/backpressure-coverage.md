# Backpressure Coverage — Companion & Coordination Reliability

**Spec**: [companion-coordination-spec.md](./companion-coordination-spec.md)
**Generated**: 2026-06-14
**Certainty**: Partial

> Advisory only — informs the architect (`plan-3`). Never blocks, never gates, no scores. (See eng-harness-2-backpressure.)

## Existing Sensors (inventory)

Single package (no monorepo); all sensors at root. Probed: `justfile`, `package.json#scripts`, `vitest.config.ts`, `.github/workflows/ci.yml`, `src/schemas/*.json`, `test/**`.

| Sensor | Command | Dimension | Found in |
|--------|---------|-----------|----------|
| lint | `npx biome check .` (`just lint`) | maintainability | root |
| format | `biome format` (`just format`) | maintainability | root |
| build | `tsc && copy-schemas` (`just build`) | maintainability | root |
| typecheck | `tsc --noEmit` (`just typecheck`) | maintainability | root |
| **test suite** | `vitest run` (`just test`) — unit + integration + `test/e2e/*` | **behaviour** | root |
| audit | `npm audit --audit-level=high \|\| true` | maintainability (non-blocking) | root |
| sdk-check | `scripts/check-sdk-version.sh` (`just sdk-check`) | behaviour (SDK pin) | root |
| composite gate | `just fft` = lint+format+build+typecheck+test+audit+sdk-check | all | root |
| **`minih doctor`** | `node dist/cli/index.js doctor` (CI "Agent Doctor" job) — validates every agent pack, **includes `prompt-state-vocabulary-drift`** | **behaviour / architecture-fitness** | root + `agents/*` |
| harness composite boot | `harness boot` = biome + tsc + `just check` + `minih doctor` + npm audit | behaviour | `.harness/` |
| **AJV schema validation** | 14 schemas incl. `inside-state.json`, `system-output.json`, `inbox-message.json`, `retrospective.json`, `permission-policy.json` | data / contract integrity | `src/schemas/` |

**Directly relevant test seams** (the precedent map for this plan's TDD):

| Seam | Proves today | Reuse for |
|---|---|---|
| `test/runner/event-wait.test.ts`, `test/runner/wait-for-any-fs.test.ts` (+ `FakeNativeWatcher`, `vi.useFakeTimers`) | `wait_for_any` current semantics, deterministic timing | #40 (AC-3/4/5) |
| `test/runner/inbox-poll.test.ts`, `test/mcp/inbox.test.ts` | inbox filter chain, unread/ack model | #40, #36 ledger |
| `test/mcp/state.test.ts`, `test/runner/state.test.ts`, `test/cli/state.test.ts` | enum validation, 3-level schema resolution | #27/#31 (AC-6) |
| `test/cli/doctor-state-vocabulary.test.ts` | prompt-vs-schema drift detection | #27/#31 (AC-7) |
| `test/runner/permissions/coord-write-precondition.test.ts`, `test/cli/run-coord-write-deny.test.ts` | E205 write-deny boot gate | #25 (AC-1) |
| `test/mcp/coordination-contract.test.ts` | MCP tool contracts (incl. `permission_status` precedent) | #29 (AC-14), #36 inside tool |
| `test/e2e/two-agent-coordination.test.ts` (`describe.skip` by default) | full outside↔inside round-trip | #40/#35 end-to-end (manual/opt-in) |

**Known absent seam**: `MINIH_FAKE_ADAPTER` — **not present** (`grep` over `src/` + `test/` → no match). This is plan 026's SUGG-001: a real `minih run` needs `GH_TOKEN` + the Copilot CLI, so built-CLI subprocess tests cannot drive a full coordinated run end-to-end deterministically. It is the single sensor whose absence pushes the hardest behaviour rows (live #40 delivery, live #35 idle/drain) from `computational` to `inferential`.

## Coverage Matrix

| Criterion / failure mode | Deterministic sensor | Status | Tier | Probe trail (ABSENT only) |
|---|---|---|---|---|
| **AC-1** (#25) write/E205 path reaches a terminal artifact loudly | `run-coord-write-deny.test.ts` + `coord-write-precondition.test.ts` | **EXISTS** | computational | — |
| **AC-2** (#25) doc corrected (E205 fires at boot, not as inbox msg) | doc prose accuracy | ABSENT | inferential | searched `**/*.test.ts` for doc-string assertions; no sensor proves prose *correctness* (a phrase-drift check could catch the stale phrase — see Phase 0) |
| **AC-3** (#40) queued-before-call message delivered; snapshot impl fails | new test on `event-wait.test.ts` + `FakeNativeWatcher`/fake timers | BUILDABLE | computational | — |
| **AC-4** (#40) `wait_for_any`↔`inbox_list` parity for same filter | new cross-primitive test on existing seams | BUILDABLE | computational | — |
| **AC-5** (#40) no-filter entry wakes on a new/unknown `type` | new test on `event-wait.test.ts` | BUILDABLE | computational | — |
| **AC-6** (#27/#31) schema accepts full companion vocabulary | `mcp/state.test.ts` (enum validation) + per-pack schema fixture | EXISTS | computational | — |
| **AC-7** (#27/#31) `minih doctor` reports no state-vocab drift | `doctor-state-vocabulary.test.ts` + `minih doctor` | **EXISTS** | computational | — |
| **AC-8** (#36) `deriveCompanionLedger` computes counts from lane fixtures | new unit test (pure function over NDJSON fixtures) | BUILDABLE | computational | — |
| **AC-9** (#36) draft farewell validates against `system-output.json` | AJV validation (mechanism EXISTS) + new finalize test | BUILDABLE | computational | — |
| **AC-10** (#32) findings home singular; prompt+schema+docs agree | findings-derived-from-inbox = code-testable; doc agreement = phrase-drift check | BUILDABLE (structural) / ABSENT (prose) | computational + inferential | doc-prose agreement has no sensor today; a contract-phrase doctor check would cover it (Phase 0) |
| **AC-11** (#35) not prematurely stood down mid-phase | new test driving ledger state — **only if idle policy is ledger-driven runtime, not prompt-only** | BUILDABLE\* | computational | \*if left prompt-only, becomes ABSENT/inferential (LLM-run only) — see note |
| **AC-12** (#35) configured idle budget discoverable at runtime | new test on the self-discovery tool | BUILDABLE | computational | — |
| **AC-13** (#35) late ping in stop/report window not stranded | new race test (inject late lane append before report write; `SyncEmitAdapter`/fake-timer precedent from `runner-stall.test.ts`) | BUILDABLE | computational | — |
| **AC-14** (#29) self-discovery tool returns allowedStates/mode/idleBudget | new MCP tool test (mirror `permission_status` tests) | BUILDABLE | computational | — |
| **AC-15** (#32/#29) AGENTS_README + companion-mode.md reconciled to contract | contract-phrase drift check (BUILDABLE) for known phrases; full reconciliation = prose | BUILDABLE (phrases) / ABSENT (prose) | computational + inferential | no sensor proves doc prose is fully reconciled; phrase-level drift is catchable (Phase 0) |
| **AC-16** housekeeping: registry tool count (8), new tools/verbs listed | new doctor/registry check or unit assertion | BUILDABLE | maintainability | — |
| **AC-17** `just fft` exit 0, no coordination-suite regression | `just fft` | **EXISTS** | computational | — |
| **Live behaviour residual** (#40/#35): a real multi-minute companion run actually receives pings on time and doesn't stand down mid-phase | `test/e2e/two-agent-coordination.test.ts` (opt-in) + code-review-companion dogfood + `plan-7` review | ABSENT (today) → BUILDABLE with fake-adapter seam | inferential | `grep MINIH_FAKE_ADAPTER src/ test/` → no match; e2e suite is `describe.skip` and needs `GH_TOKEN`+Copilot CLI |

## Certainty: Partial

Of the behaviour/architecture criteria: 3 are **EXISTS** (AC-1 write-deny gate, AC-7 doctor drift, AC-17 fft; plus AC-6 enum validation), the rest are **BUILDABLE on existing vitest/MCP/doctor seams** (unit-level, deterministic — fake timers and FakeNativeWatcher already power the `wait_for_any` suite). The only irreducibly **ABSENT** rows are (a) doc-prose *correctness* (AC-2/AC-10/AC-15 — legitimately inferential, routed to review) and (b) the **live end-to-end** companion behaviour for #40/#35, which is dogfood/`plan-7` territory today but becomes BUILDABLE if the fake-adapter seam is built. No behaviour criterion is ABSENT *with no path* → **Partial**, not Weak.

## Recommended Phase 0: Establish Backpressure

Two sensors are worth building **before** the feature work, because they convert the most consequential gaps from inferential to computational. Everything else in the matrix is ordinary TDD on seams that already exist — no Phase 0 needed for those.

| Sensor to build | Proves | Suggested form |
|---|---|---|
| **`MINIH_FAKE_ADAPTER` env seam** (plan 026 SUGG-001) | Upgrades the **live #40 delivery** and **#35 idle/stop-drain** end-to-end rows from ABSENT/inferential → BUILDABLE: a built-CLI subprocess test can drive a full coordinated run (outside pings → inside wake → findings → farewell) deterministically, without `GH_TOKEN`/Copilot CLI. Directly de-risks the two hardest clusters and unblocks the otherwise-skipped `two-agent-coordination` e2e. | env seam in `src/adapter` SDK-runtime selection (a scripted adapter chosen when `MINIH_FAKE_ADAPTER` is set), driving `inbox`/`state`/`wait_for_any` over real lanes |
| **Contract-phrase drift check** (extends `minih doctor`) | Turns #32/#15 docs-vs-code drift (AC-2/AC-10/AC-15 prose rows) from inferential → computational for the *known* contract phrases: findings-home wording, exit-reason vocabulary (incl. `no_engagement`), state vocabulary, MCP tool count. Mirrors the existing `prompt-state-vocabulary-drift` check. | a `doctor` check (or a small grep-based test) asserting AGENTS_README / companion-mode.md / prompt carry the agreed phrases and not the retired ones |

> Both are **recommendations**, not requirements. The fake-adapter seam is the higher-leverage one — it's a recurring ask (SUGG-001) whose absence is *why* plan 026's HIGH bug slipped through a test-seam blind spot, and it pays off across #40, #35, and future coordination work. The contract-phrase check is cheap insurance against the exact drift class (#32) that motivated this plan.

## Notes for the architect

- **AC-11 is design-coupled**: its testability depends on workshop 003's decision to make idle policy **ledger-driven runtime** (BUILDABLE, unit-testable) rather than prompt-only (ABSENT, LLM-run only). The workshop already leans ledger-driven — this survey confirms that choice also buys deterministic backpressure. Worth folding the fake-adapter seam in as the plan's Phase 0/Phase 1 enabler.
- **#27/#31 is the best-covered cluster**: the drift sensor (`minih doctor`) and enum-validation seam both already EXIST — the per-pack schema fix lands green immediately and a doctor test pins it.
- **Architecture-fitness tier (considered, no sensor warranted)**: the one boundary risk is `companion status/finalize` (cli) reaching coordination data. The design routes it through runner's existing coordination-file helpers (cli → runner is the legal direction; the deriver lives in runner, not cli), so the only violation would be cli importing mcp internals directly — which the design avoids. With ~2–3 touch-points and the legal seam already chosen, code review + domain docs cover it; a dependency-direction checker (dependency-cruiser/ArchUnit) is a repo-wide investment this plan doesn't justify. **Verdict: low risk → no Phase-0 architectural sensor.** (Recorded so the tier is explicitly weighed, not skipped.)
- **How this differs**: `plan-3` G6 only checks that test tasks exist; `plan-7` is the eyeball tier (covers the ABSENT prose rows + live residual). This survey is the computational tier — it says the build is mostly deterministically provable on existing seams, with two high-value sensors worth standing up first.
