# Execution Log — Phase 1: Run-discovery fail-open (A/B/C)

**Plan**: companion-mode-reliability (028) · **Branch**: `028-companion-mode-reliability` · **Mode**: Full TDD · **Companion**: `code-review-companion`

---

## T000 — Harness pre-flight (pre-implement seam)

- **Seam fired**: `/eng-harness-flow --event pre-implement` → routed to boot validation (`harness boot --json`).
- **Boot verdict**: `status: error` — **but the sole failing sensor is `lint` (`npx biome check .`) and biome is not installed** (doctor's `toolchain` layer flags the same). Substantive sensors: `typecheck` **pass (clean)**, `build+test` (`just check`) **pass (clean)**, `minih-doctor` warn, `audit` warn (1 critical / 5 high).
- **Decision (override logged)**: proceed. The governance doc states "day-one degraded is honest, not broken" and `just check` runs no biome; the real readiness gates (typecheck + build+test) are green, so the TDD baseline is sound. Failure is the documented biome gap, not a real break.
- **Friction captured** (retro): `DL-001` — boot's single overall verdict can't distinguish a missing optional tool (biome) from a real break; `INS-001` — live defect-D sighting (companion runId `2026-06-16T13-50-25-287Z` vs real UTC `03:52` — local-time-as-Z, the exact bug Phase 2 fixes).

## Companion boot (C0/C0a)

- **Booted**: `minih run code-review-companion` (background) → `verdict: active`, `runId: 2026-06-16T13-50-25-287Z-8a55`.
- **Briefed**: one `--type briefing` message sent (plan/spec/phase/tasks paths, protocol, hazards F03/F04/F05 + the no-mask-stale guard, domain context). Companion confirmed `listening` (mid-poll).

---

## Tasks

### T001 — Investigate defect C (spike) ✅

**Method**: grepped `selfReportedState`/`currentlyRunningTool`/`runId` co-occurrence across `src/`; read `peer-activity.ts`, `coordination-status.ts`, `history.ts`, `last-run.ts`, `folder.ts` (`resolveAgent`/`listAgents`).

**Findings**:
1. `selfReportedState`/`currentlyRunningTool` appear **only** in `src/runner/peer-activity.ts`, which never references `runId`.
2. No `runId: null` (or `runId:undefined`) co-serialization exists anywhere in `src/`.
3. `coordination-status.ts` (the MCP boot-detection surface) takes `context.runId` as an *input* (`:82`) but its result shape (`agentSlug`, `coordinationMode`, `ledger`, `draftFarewell`, `idleBudgetSec`, `allowedStates`) emits **no** top-level `runId` and **no** peer fields.
4. `resolveAgent(slug, agentsDir)` (`folder.ts:733-739`) is literally `listAgents(agentsDir).find(a => a.slug === slug) ?? null`. `history.ts:32` and `last-run.ts:31` both call it → **they already resolve exactly what `minih list` resolves**. `E121 AGENT_NOT_FOUND` only fires for an agent that is genuinely unlistable (no `prompt.md`, empty `description`, `_`-prefixed, or invalid slug).

**Decision (AC-C fallback, per Finding 05)**: the literal defect-C symptom is **not reproducible against current core** — it is external/older-build. C is satisfied by (a) a **characterization test** locking `history`/`last-run` ↔ `list` resolution consistency (no future divergence), and (b) this documented finding. **No core production edit** for the C symptom. (Note: `history.ts:53` / `last-run.ts:58` sort run dirs by `.name` — that's defect D, owned by Phase 2 task 2.4, not touched here.)
