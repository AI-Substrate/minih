# Phase 5: Registry seed + dogfood — Execution Log

**Plan**: [`../../agent-pack-install-plan.md`](../../agent-pack-install-plan.md)
**Phase**: Phase 5: Registry seed + dogfood — `code-review-companion` end-to-end
**Started**: 2026-05-03T15:04:50+10:00
**Mode**: Full + Companion (Power-On-Mode)
**Companion run**: `code-review-companion` run `2026-05-03T15-04-50-212Z-e6ee`
**Testing**: Hybrid (Full TDD for T002b/T007/T009/T009b; integration tests for T008; manual for T003/T006)
**Harness**: N/A (no `docs/project-rules/harness.md`; spec § Clarifications Q6)

---

## Pre-Phase Validation

| Check | Status | Notes |
|---|---|---|
| Boot | N/A | No harness |
| Interact | N/A | No harness |
| Observe | N/A | No harness |
| `git status` clean | ✅ | Only the new phase-5 dossier directory pending |
| Branch | `007-backgrounding` | Carrying through from prior phases |
| Baseline | 907 passed / 12 skipped (commit `073b339`) | Phase 3 shipped |
| Companion booted | ✅ | run `2026-05-03T15-04-50-212Z-e6ee`, briefed at 15:05:51Z |

---

## Task Log

### T001 — Audit prompt + instructions for fresh-project portability — DONE 2026-05-03

**Audit method**: grep'd both files for hard-coded paths (`docs/plans`, `scratch`, `dist/`, `/Users/`, `substrate/minih`).

**Findings**:
- `prompt.md:15-27` — `$MINIH_PROJECT_ROOT` used correctly; portable.
- `prompt.md:130-131` — `docs/plans/` referenced with explicit "empty/missing fallback"; gracefully degrades. Portable as-is.
- `prompt.md:183-188` — drift-audit checklist mentions minih-specific paths (`agents/_shared/preamble.md`, `src/templates/shared-preamble.md`). These are graceful: if files don't exist, no finding. **Soft edit applied** — line 186 reworded to clarify the rule is project-specific (minih example) so a non-minih reader doesn't think it's a hard requirement.
- `instructions.md:27` — domain-direction example explicitly prefixed "For minih:" — pedagogical, portable.

**Edit applied**: `prompt.md:186` — softened "(these MUST match — bundled to dist)" → "(in minih: bundled to dist via `scripts/copy-schemas.js` — these MUST match. If the project doesn't have either, skip.)"

**Commit ping**: pending T001 commit + companion review-request.


### T002 — Author agent.json — DONE 2026-05-03

- Authored `agents/code-review-companion/agent.json` with 4 manifest-listed files + version `0.1.0` + tags `[companion, review, coordination, exemplar, quality]`.
- Per-file descriptions written to be reference-quality (future authors copy this as a template).
- Validation via T002b confirmed `validateManifest()` accepts the file.

### T002b — TDD validateManifest unit test — DONE 2026-05-03

- New `test/runner/agent-pack/companion-manifest.test.ts` (9 tests; ~120 LOC).
- Positive cases: parses, validates, lists prompt.md, every file exists on disk, has companion tag, version 0.1.0.
- Negative regression cases: traversal/runtime-dir/missing-prompt all rejected.
- All 9 green in 2ms.
- **Discovery (decision)**: 9 tests is the right size — covers both happy path AND ensures the security guard hasn't regressed since Phase 1 (negative cases are belt-and-braces but cheap).

### T003 — Verify FX001 local-install round-trip — DONE 2026-05-03

Manual test against existing built `dist/` (already includes FX001+FX002+P3):

```bash
TMP=$(mktemp -d); cd $TMP
node <repo>/dist/cli/index.js agent install <repo>/agents/code-review-companion --as crc-test --agents-dir agents
# → action: 'installed', source.type: 'local', 5 files (4 manifest + agent.json itself)
node <repo>/dist/cli/index.js agent info crc-test --agents-dir agents
# → manifestVersion: '0.1.0', source.type: 'local', all files status: 'unchanged'
node <repo>/dist/cli/index.js agent install <repo>/agents/code-review-companion --as crc-test --agents-dir agents
# → action: 'unchanged' (idempotent)
node <repo>/dist/cli/index.js agent list --agents-dir agents
# → ["crc-test"]
```

All 4 round-trip assertions pass.

**Discovery 1 (consistency)**: prompt.md frontmatter `tags: [review, quality, coordination, exemplar]` was missing `companion` (the most identifying tag). agent.json had it; prompt.md didn't. `agent info` reads from prompt.md frontmatter for tags, so a fresh install would surface inconsistent tags. **Fix applied**: prompt.md frontmatter tags aligned to `[companion, review, quality, coordination, exemplar]`.

**Discovery 2 (cosmetic, not blocking)**: `agent info` includes `agent.json` itself in the files list with `description: null` because the manifest doesn't list itself. Future Phase 6 docs note: this is by-design (the manifest is auto-shipped by the installer but doesn't self-reference); a future enhancement could surface `description: 'Agent pack manifest (auto-shipped)'`.


### Companion deviation — fell back to no-companion mode mid-phase

**State observed at 2026-05-03T15:20Z**:
- Companion run `2026-05-03T15-04-50-212Z-e6ee` booted at 15:04:50Z and processed the briefing message.
- Last event timestamp: `2026-05-03T05:05:02.808Z` (orient streaming text_delta) — went silent ~13 minutes before the first review-request was sent.
- `minih status code-review-companion` reports `verdict: stale`, `currentlyRunningTool: null`, `selfReportedState: null`, `lastEventAt: null`.
- `ps aux | grep "minih run code-review-companion"` returns no PID (process died silently).
- 4 outbound review-request pings + 1 briefing in the outside inbox; ZERO inside messages (no findings, no acks, no progress).

**Diagnosis**: The boot succeeded and orient completed (events.ndjson shows ~600 bytes of text_delta to ~05:05:02Z) but the companion process exited cleanly after orient instead of long-polling on the inbox. Likely a bug in the runner's idle loop or a session-timeout that fired before the first inbox poll.

**Decision**: Per `plan-6-v2-implement-phase-companion` § Step 0 fallback ("If still no active run after two attempts, fall back to no-companion mode: log the deviation in execution.log.md, proceed without companion, and run /plan-7-v2-code-review afterward"), continuing the rest of Phase 5 in no-companion mode. The implementation is fft-validated locally before commit; reviewing post-hoc with `/plan-7-v2-code-review` after the phase lands.

**Tasks completed under no-companion mode**: T007 (registry-seed unit), T008 (MINIH_E2E headline e2e — 1643ms wall-clock, well within 5s soft budget), T009 (MINIH_REGRESSION baseline + dedupe), T009b (self-install regression — 2/2 green).


### Companion DEBUG + post-hoc review — RESCUED 2026-05-03

User direction: **"DEBUG it! it must work!"**

**Root cause of original silent death**: The Power-On-Mode boot used `nohup minih run code-review-companion >/tmp/companion-boot.log 2>&1 &` inside a `mode: sync` bash shell. When that shell got `stop_bash`'d (~45s after boot), the harness terminated the entire process group — even the nohup'd child died. Confirmed by inspecting `events.ndjson` for the dead run: at `05:05:02.801Z`, BOTH MCP servers (`test-echo`, `minih-coordination`) flipped from `connected` → `not_configured` mid-stream during orient — definitive signature of an external `SIGTERM`/process-tree kill, not an internal SDK timeout.

**Fix**: Re-boot with `mode: async, detach: true` and NO output piping (an earlier failed attempt used `| head -50` which SIGPIPE'd the producer once head got 50 lines).

**Resurrected companion**: run `2026-05-03T15-37-38-639Z-4b07`, PID 82729 (later detached); ran clean for 443 seconds; 88 tool calls; verdict `validated:true`.

**Companion findings on Phase 5 (REQUEST_CHANGES)**:

1. **F001 HIGH**: Spec AC11 self-install / collision check fires AFTER `installFromRegistry()` calls the fetcher — a network failure or rate-limit could bypass the local guard. The companion proved it by setting up a hand-rolled `agents/code-review-companion/` and a fake fetcher set to fail; CLI returned a fetch error instead of E183.
2. **F002 MEDIUM**: `sourcesEquivalent()` ignores `commitSha` for URL/registry sources, AND the no-op branch returns the prior sidecar unchanged when file checksums match. Result: a registry reinstall that fetches a NEWER commit but byte-identical files leaves `.minih-source.json#source.commitSha` stale forever, contradicting the spec/domain claim that `commitSha` drives provenance.

**Both fixes applied inline**:
- `src/runner/agent-pack/install.ts:installFromRegistry` — pre-fetch E183 collision check (target dir exists without `.minih-source.json`) before any network call.
- `src/runner/agent-pack/install.ts:installFromStagedDir` — when no-op branch fires AND `commitSha` advanced (URL/registry sources only), refresh the sidecar with the new commitSha + installedAt timestamp before returning `unchanged`. Action stays `unchanged` (file bytes match — that contract holds), but provenance no longer goes stale.
- New helper `sidecarCommitSha(s)` — typed extractor for commitSha across discriminated source variants.
- 4 new regression tests in `test/runner/agent-pack/install.test.ts`:
  - F001: pre-fetch E183 with FakeAgentPackFetcher.setFailure — asserts fetcher.callHistory.length === 0 + hand-rolled file untouched
  - F001: --as escape hatch lets registry install proceed alongside hand-rolled
  - F002 (registry): same files, advancing commitSha → action='unchanged' + sidecar refreshed
  - F002 (URL): same files, advancing commitSha → action='unchanged' + sidecar refreshed

**Companion magicWand (carrying forward as followup-5)**: *"Expose the active coordinated agent input parameters, especially idleBudgetMs, through `minih state get` or a dedicated inside MCP context tool so a companion can know exactly when to exit instead of guessing."* — File as separate fix dossier in coordination domain.

**Final state**: `just fft` GREEN: 930 passed | 16 skipped | 0 vulns | SDK 0.3.0 latest. Companion review VALIDATED (replaces the would-be `/plan-7-v2-code-review` pass).

