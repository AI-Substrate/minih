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

---

## T002 — Verify / tighten the E205 doc (AC-2, doc half)

**Verdict: no edit needed — the doc was already correct.** `companion-mode.md:23` states the precondition "enforces this **at boot** via the FX008 precondition; agents whose resolved policy denies write are refused with E205," and delegates message-format / remediation detail to `permissions.md § Coordinated agents`.

Repo sweep (`grep -i 'e205|permission-error|inbox' docs/how/companion-mode.md`): **exactly one** E205 mention, accurate. `permissions.md` carries the full detail consistently — `:134` "enforces this at boot," `:83-90` lists the inbox `permission-error` message as **one of five** signals fired *after* the boot-time refusal, `:123` the E205 table row ("FX008 boot precondition"). **No doc anywhere describes E205 as *arriving as* an inbox message** — the research dossier's DE-05 premise (carried only in plan 027's own spec/research) was wrong; the product docs were always right.

The boot-gate-vs-inbox distinction T002 reserved a ≤1 clause for is already cleanly handled (boot refusal stated in both docs; the inbox message correctly framed as signal-among-five in permissions.md). Adding a clause would over-explain a doc that correctly delegates → recorded "no edit," per the dossier's instruction not to invent a change. The dropped-Phase-0 "(contract-phrase check from 0.4)" criterion never lived in the doc (it was a plan task criterion) — nothing to strike here.

**Correction (companion F001, MEDIUM — applied):** the "no edit needed" verdict held for `companion-mode.md` and for the *boot-timing* wording — but the code-review-companion's final sweep caught a stale **lane path** in `permissions.md:89`. Signal #4 of the 5-signal protocol listed the `permission-error` message at `inbox/outside/messages.ndjson`, whereas the runner writes it to the **inside** lane (`error-signal.ts:167` → `inboxLanePath(location, 'inside')`; the function is *named* `fireOutsideInboxSignal` for the operator view, but the physical file is `inbox/inside/`), which the CLI regression already asserts. Fixed `permissions.md:89` → `inbox/inside/messages.ndjson` (+ a note that operators read it via `minih outside inbox list`). So T002 is **one small doc fix**, not "no edit" — a real catch that keeps the #25 close-comment honest.

---

## T003 — #25 disposition (close-comment summary, AC-2)

**Disposition: VERIFIED — close as fixed.** The FX008 boot gate (shipped in plan 018) kills the coordinated write-deny repro on the **live** default path. Quotable close comment:

> **#25 verified fixed — closing.**
>
> A coordination-enabled agent whose resolved write policy is `deny` no longer fails silently (running for the full timeout, then exiting without ever writing `output/report.json`). It is now **refused at boot** with `E205 COORDINATION_WRITE_DENIED` — a sub-second, actionable error carrying the slug, resolved preset, resolution-chain source, and three remediations — via the FX008 precondition (`assertCoordWriteAllowed`, `src/runner/permissions/coord-write-precondition.ts`), wired at `runner.ts` right after the policy compile.
>
> This is the **live** default path, not a hypothetical: since plan 018 R6 the shipped release default is `restricted` (write-deny) — `presets.ts` `minihReleaseDefault` — so a *new* coordination-enabled agent with no explicit `permissions:` (and no sidecar `lockedDefault`) resolves to write-deny and trips the gate. Grandfathered installs with a sticky `yolo` sidecar `lockedDefault` keep write-allow and are unaffected.
>
> **Proof (deterministic, green):**
> - `test/runner/permissions/coord-write-release-default.e2e.test.ts` (5 tests) — drives a *real* `compile()` release-default resolution → `restricted` / `presetSource: 'release-default'` / `write: deny`, then through `assertCoordWriteAllowed` → throws E205; plus the bare-fallback path, the grandfathered-yolo write-allow asymmetry, and a premise guard that reddens if the default is ever re-flipped.
> - `test/cli/run-coord-write-deny.test.ts` case `(a-release-default)` — a zero-permissions coord agent run through the full CLI → E205 envelope, `Resolved from: release-default`, `run.json` `permissions.presetSource: 'release-default'`, exit 126. The pre-existing case `(a)` covers the full 5-signal denial (events.ndjson, run.json, inside-state, inside-inbox `permission-error`, exit 126) via the frontmatter path.
>
> **Docs:** `companion-mode.md` describes E205 accurately as a **boot-time refusal** — no change needed. `permissions.md` needed one small correction (the code-review-companion caught that the 5-signal protocol listed the `permission-error` message under `inbox/outside/` when the runner writes it to the **inside** lane — `permissions.md:89` fixed). The boot-timing wording was always correct; the "described as an inbox message" concern from this plan's spec/research did not match disk.

A stale R1-era comment in `runner.ts` (it still claimed agents default to `yolo`) was corrected to the R6 reality — comment-only, no behaviour change.

**Phase 1 complete:** AC-1 (boot gate proven, deterministic test) ✅ · AC-2 (doc corrected — 1 companion-caught lane fix — + disposition recorded) ✅. One new test file, one CLI case, one comment fix, one doc lane fix — the verify-and-close shape held.
