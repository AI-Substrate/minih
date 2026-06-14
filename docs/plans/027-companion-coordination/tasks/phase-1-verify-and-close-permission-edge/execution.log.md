# Execution Log — Phase 1: Verify-and-close permission edge (#25)

**Plan**: companion-coordination · **Phase**: 1 (CS-1) · **Mode**: Full (Full TDD)
**Companion**: `code-review-companion` (Power-On-Mode) — runId `2026-06-15T07-39-33-328Z-5100`
**Started**: 2026-06-15

---

## T000 — Harness pre-implement seam (`--event pre-implement`)

Fired `/eng-harness-flow --event pre-implement` through the installed router (`~/.agents/skills/eng-harness-flow`). Engineering dispatch was open (S0 CLI 0.2.0 + S2 governance doc + loop substrate all present), so it routed to boot validation (`harness boot --json`).

- **First boot → `status: error` (UNHEALTHY).** Sole failing sensor: `lint` (`npx biome check .`). typecheck pass, build+test (`just check`) pass; `minih-doctor` warn (known day-one), `audit` warn (1 critical / 6 high, pre-existing).
- **Root cause:** a single biome **formatter** diff in `docs/plans/027-companion-coordination/the-flow.json` — the flight-plan file the flow itself regenerated during the tasks/validate stage. Not source code.
- **Decision (human, Jordan):** *Format & re-boot.* Ran `biome format --write` on that one JSON; re-ran boot → **`status: degraded` (SLOW)** — lint/typecheck/build+test all pass; only the known `minih-doctor` + `audit` warnings remain. Governance: "degraded is honest, not broken." → **proceed with note.**
- **Friction captured:** `harness observe … --kind improvement-suggestion` → **SUGG-001** ("the-flow should emit biome-formatted JSON so the pre-implement boot isn't tripped by the flow's own bookkeeping").
- **Companion:** no active run found (latest was `completed`); booted a fresh `code-review-companion` → verdict `active` (runId above). gh token present.

**Seam outcome:** envelope `decision: route`, verdict `UNHEALTHY → (fixed) → SLOW/degraded`, proceeded with note.

---

## T001 — Prove the #25 repro is dead (AC-1)

**The confirmed-uncovered gap (GF-5 / validate-v2 Source-Truth):** no test drove a *real* `compile()` release-default resolution **through** the FX008 boot gate to write-deny → E205. `compile.test.ts` drives `compile()` but never feeds the gate; `coord-write-precondition.test.ts` drives the gate but *synthesises* the policy (case (a) stamps the `release-default` label by hand — the file's own docstring says "No filesystem or compile() coupling"); the CLI regression drove via *frontmatter*.

**What landed:**
1. **New seam characterisation file** — `test/runner/permissions/coord-write-release-default.e2e.test.ts` (5 tests). Drives the **real `compile()`** with only `releaseDefault: { preset: minihReleaseDefault }` populated (mirroring `runner.ts:667-674` for an agent with no frontmatter/sidecar/env) → asserts `restricted` / `presetSource: 'release-default'` / `write: deny`, then feeds that real policy into `assertCoordWriteAllowed` → **throws E205** (`presetSource` is the one `compile()` stamped, not synthesised). Also covers: the bare `releaseDefault: {}` constant fallback, the grandfathered `sidecar lockedDefault: yolo` write-allow asymmetry (gate does NOT fire), and a **premise guard** (`minihReleaseDefault === 'restricted'` and that preset denies write — goes red if a future release re-flips the default).
2. **New CLI case** — `run-coord-write-deny.test.ts` `(a-release-default)`: a coord agent with **NO `permissions:` block** (the literal #25 real-world repro) run through the full CLI → E205 envelope, `Resolved from: release-default`, run.json `permissions.preset: 'restricted'` / `presetSource: 'release-default'` / `decisions.write: 'deny'`, exit 126. Complements the existing frontmatter case (a).
3. **Stale-comment fix (grounding-driven)** — `src/runner/runner.ts:644-651`. The R1-era comment still claimed agents "get `releaseDefault.preset = 'yolo'` and behave exactly as before" while line 671 passes `releaseDefault: { preset: minihReleaseDefault }` (= `restricted`). This is the exact artifact (GF-5) that misled the plan and the dossier's first draft. Rewrote it to the R6 reality (default is `restricted`/write-deny; grandfathered installs keep yolo via sidecar; a handler is built for any non-yolo policy; coord + write-deny trips the FX008 gate below). Comment-only — zero behaviour change; `isNonDefaultPolicy` docstring verified accurate and left untouched.

**Evidence:** `npx vitest run` both files → **8 passed (8)** (5 seam + 3 CLI incl. the new case). Build green (`npm run build`). Biome clean on all three touched files.

**Placement note (deviation from dossier path):** the dossier suggested adding to `coord-write-precondition.test.ts`, but that file's documented contract is "No filesystem or compile() coupling." A compile()-coupled characterisation belongs in a dedicated file → created the `.e2e.test.ts` instead. Recorded in Discoveries.

**Conclusion:** the #25 repro is dead on the **live default path** — the boot gate fires loudly (E205, 5 signals, exit 126); no silent missing `report.json`.
