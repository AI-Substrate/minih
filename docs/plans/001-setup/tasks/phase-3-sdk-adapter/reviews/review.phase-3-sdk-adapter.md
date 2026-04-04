# Code Review: Phase 3: SDK Adapter

**Plan**: /Users/jordanknight/substrate/minih/docs/plans/001-setup/miniharness-extraction-plan.md
**Spec**: /Users/jordanknight/substrate/minih/docs/plans/001-setup/miniharness-extraction-spec.md
**Phase**: Phase 3: SDK Adapter
**Date**: 2026-04-04
**Reviewer**: Automated (plan-7-v2)
**Testing Approach**: Hybrid

## A) Verdict

**REQUEST_CHANGES**

Phase 3 stays in scope and clears the repository quality gate, but the adapter currently misses an existing runner contract: it never emits `session_start`, so timed-out real SDK runs cannot terminate the live session. The adapter also drops `cwd` before reaching the SDK, truncates tool-completion output, and leaves resumed sessions connected after `compact()`.

**Key failure areas**:
- **Implementation**: The runner only captures the active session ID from `session_start`, but `SdkCopilotAdapter` never emits it for real SDK sessions.
- **Domain compliance**: `adapter/domain.md` records the Phase 3 history row but does not document `copilot-types.ts` or the expanded adapter facade surface.
- **Testing**: `just fft` passed, but SDK-specific behavior is still validated mostly by static inspection; the blocking issues surfaced only via synthetic runtime reproduction during review.

## B) Summary

The phase cleanly confines source changes to the adapter domain, introduces no concept duplication, and keeps `src/` free of `@chainglass/*` imports. `just fft` passed during review, and `npm pack --dry-run --json` shows the package currently packs cleanly, so the basic build/test/release path is intact. The problems are integration-level: `SdkCopilotAdapter` does not emit `session_start`, does not pass `cwd` through as the SDK's `workingDirectory`, flattens `tool.execution_complete` too aggressively, and does not clean up resumed sessions after `compact()`. Adapter domain docs were only partially refreshed, so the new local Copilot facade is missing from Composition, Contracts, and Concepts. Coverage for the phase acceptance criteria is reasonable, but it remains biased toward static verification because real CLI wiring arrives in Phase 4.

## C) Checklist

**Testing Approach: Hybrid**

- [x] Core validation checks present
- [ ] Critical SDK integration paths covered
- [ ] Key verification points documented with phase-local evidence
- [x] Only in-scope files changed
- [x] Linters/type checks clean (if applicable)
- [ ] Domain compliance checks pass

## D) Findings Table

| ID | Severity | File:Lines | Category | Summary | Recommendation |
|----|----------|------------|----------|---------|----------------|
| F001 | HIGH | `/Users/jordanknight/substrate/minih/src/adapter/sdk-copilot.ts:45-91` | correctness | `SdkCopilotAdapter` never emits `session_start`, so the runner timeout path cannot terminate the real SDK session. | Emit a synthetic `session_start` event immediately after `createSession()` / `resumeSession()` succeeds. |
| F002 | MEDIUM | `/Users/jordanknight/substrate/minih/src/adapter/copilot-types.ts:20-31`; `/Users/jordanknight/substrate/minih/src/adapter/sdk-copilot.ts:32-56` | correctness | The local Copilot config facade omits `workingDirectory`, so `AgentRunOptions.cwd` is dropped before reaching the SDK. | Add `workingDirectory?: string` to the local config types and pass `options.cwd` through on create/resume. |
| F003 | MEDIUM | `/Users/jordanknight/substrate/minih/src/adapter/sdk-copilot.ts:261-268` | error-handling | `tool.execution_complete` translation loses `detailedContent` and error text, so failed or diff-heavy tool calls surface blank/truncated output. | Prefer `result.detailedContent ?? result.content ?? error.message ?? ''` when building `tool_result.output`. |
| F004 | LOW | `/Users/jordanknight/substrate/minih/src/adapter/sdk-copilot.ts:133-166` | performance | `compact()` resumes a session and returns without disconnecting it, leaking live session handles across repeated compactions. | Clean up the resumed session in `finally` after `/compact` completes; prefer `disconnect()` on the local SDK facade. |
| F005 | LOW | `/Users/jordanknight/substrate/minih/docs/domains/adapter/domain.md:11-36` | domain-compliance | The adapter domain doc omits `copilot-types.ts`, the expanded adapter barrel surface, and a matching concept entry for the local Copilot facade. | Update `adapter/domain.md` Composition, Contracts, and Concepts to reflect the Phase 3 public surface. |

## E) Detailed Findings

### E.1) Implementation Quality

- **F001 (HIGH)** — `/Users/jordanknight/substrate/minih/src/adapter/sdk-copilot.ts:45-91`
  The adapter creates or resumes the SDK session, then listens for SDK events and forwards translated `AgentEvent`s to the runner. However, it never emits a `session_start` event carrying `session.sessionId`. The runner timeout path only learns the active session ID from `session_start` (`/Users/jordanknight/substrate/minih/src/runner/runner.ts:166-167`), and the timeout test depends on that contract via the fake adapter (`/Users/jordanknight/substrate/minih/test/runner/runner.test.ts:384-412`). Review reproduction against the built adapter printed `session_start_emitted false`, confirming the real adapter currently leaves timeout cleanup targeting `terminate('')`.

- **F002 (MEDIUM)** — `/Users/jordanknight/substrate/minih/src/adapter/copilot-types.ts:20-31`; `/Users/jordanknight/substrate/minih/src/adapter/sdk-copilot.ts:32-56`
  `AgentRunOptions` carries `cwd`, and the installed SDK supports `workingDirectory` in both create and resume configs (`/Users/jordanknight/substrate/minih/node_modules/@github/copilot-sdk/dist/types.d.ts:943-993`). Phase 3's local facade omits that field, and `run()` never forwards `options.cwd`. Review reproduction printed `create_has_working_directory false`, so real tool calls can run in the client's default directory instead of the requested working directory.

- **F003 (MEDIUM)** — `/Users/jordanknight/substrate/minih/src/adapter/sdk-copilot.ts:261-268`
  The adapter translates `tool.execution_complete` using `event.data?.result?.content` only. The installed SDK exposes both `result.content` and `result.detailedContent` for successful tool output (`/Users/jordanknight/substrate/minih/node_modules/@github/copilot-sdk/dist/generated/session-events.d.ts:1875-1925`), and failures also carry `error.message`. Review reproduction printed `tool_result_payload {"toolCallId":"tc1","output":"short","isError":true}`, which confirms the adapter currently drops richer diagnostics.

- **F004 (LOW)** — `/Users/jordanknight/substrate/minih/src/adapter/sdk-copilot.ts:133-166`
  `compact()` resumes a session, runs `/compact`, and intentionally skips cleanup. The installed SDK documents `disconnect()` as the supported cleanup method and marks `destroy()` deprecated (`/Users/jordanknight/substrate/minih/node_modules/@github/copilot-sdk/dist/session.d.ts:380-398`). Review reproduction printed `compact_destroy_calls 0`, confirming that repeated compactions leave dropped-but-still-live session handles behind.

No material security or reinvention issues were found in the Phase 3 runtime code.

### E.2) Domain Compliance

| Check | Status | Details |
|-------|--------|---------|
| File placement | ✅ | New source files live under `/Users/jordanknight/substrate/minih/src/adapter/`; documentation changes are phase artifacts under the phase folder. |
| Contract-only imports | ✅ | Phase 3 source imports stay within adapter-local files and do not reach into other domains' internals. |
| Dependency direction | ✅ | Adapter remains the leaf domain under the documented `cli → runner → adapter` flow. |
| Domain.md updated | ❌ | `/Users/jordanknight/substrate/minih/docs/domains/adapter/domain.md:11-36` adds history only; Composition/Contracts/Concepts do not reflect the new local Copilot facade or the expanded adapter barrel surface. |
| Registry current | ✅ | `/Users/jordanknight/substrate/minih/docs/domains/registry.md:1-7` already lists the three domains; Phase 3 adds no new domain. |
| No orphan files | ✅ | Changed source files all map to the adapter domain or expected phase/repo artifacts. |
| Map nodes current | ✅ | `/Users/jordanknight/substrate/minih/docs/domains/domain-map.md:1-11` still lists the correct three domains. |
| Map edges current | ✅ | Phase 3 adds no new inter-domain edges; the existing map remains accurate. |
| No circular business deps | ✅ | Dependency flow remains linear and acyclic. |
| Concepts documented | ⚠️ | Concepts exist for the adapter domain, but they were not extended for the local Copilot SDK facade added in Phase 3. |

- **F005 (LOW)** — `/Users/jordanknight/substrate/minih/docs/domains/adapter/domain.md:11-36`
  The history row mentions `copilot-types.ts`, but the rest of the domain doc still behaves as though the adapter domain only exposes `events.ts`, `interface.ts`, `fake.ts`, and `index.ts`. That leaves the new local SDK facade and exported adapter surface undocumented for downstream reviewers and implementers.

### E.3) Anti-Reinvention

| New Component | Existing Match? | Domain | Status |
|--------------|----------------|--------|--------|
| Local Copilot SDK facade (`/Users/jordanknight/substrate/minih/src/adapter/copilot-types.ts`) | None | adapter | proceed |
| `SdkCopilotAdapter` (`/Users/jordanknight/substrate/minih/src/adapter/sdk-copilot.ts`) | None | adapter | proceed |

### E.4) Testing & Evidence

**Coverage confidence**: 88%

`just fft` reran cleanly during review (lint → format → build → typecheck → test → audit), with 63 tests passing and zero vulnerabilities. Phase-local evidence is strongest for AC1 and AC4. AC2 and AC3 are still supported mostly by static source inspection plus synthetic adapter reproduction because real CLI wiring for the SDK lands in Phase 4.

| AC | Confidence | Evidence |
|----|------------|----------|
| AC1 | 97 | `git diff` plus `/Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-3-sdk-adapter/reviews/_computed.diff` show the adapter files added in-scope; `rg '@chainglass/' /Users/jordanknight/substrate/minih/src` returned no matches; `just fft` reran successfully. |
| AC2 | 68 | `/Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-3-sdk-adapter/tasks.md:98-117` defines the expected SDK→`AgentEvent` map, and `translateEvent()` covers the documented SDK event families, but review reproduction exposed output-loss in `tool.execution_complete` translation. |
| AC3 | 84 | `approveAll` is defined in `/Users/jordanknight/substrate/minih/src/adapter/sdk-copilot.ts:20` and wired into create/resume flows for `run()`, `compact()`, and `terminate()`. |
| AC4 | 99 | `/Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-3-sdk-adapter/execution.log.md:38-40` claims `just fft` passed, and review reran `just fft` and observed build/typecheck/test/audit success with `63/63` tests passing. |

### E.5) Doctrine Compliance

N/A — no `/Users/jordanknight/substrate/minih/docs/project-rules/rules.md`, `idioms.md`, `architecture.md`, or `constitution.md` files were present for this repository.

### E.6) Harness Live Validation

N/A — no harness configured. `/Users/jordanknight/substrate/minih/docs/project-rules/harness.md` is absent, and `/Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-3-sdk-adapter/execution.log.md:9-12` records: "UNAVAILABLE — No harness.md exists. Using `just fft`."

## F) Coverage Map

| AC | Description | Evidence | Confidence |
|----|-------------|----------|------------|
| AC1 | SdkCopilotAdapter compiles with zero `@chainglass/*` imports | `_computed.diff`; `rg '@chainglass/' /Users/jordanknight/substrate/minih/src`; successful `just fft` rerun | 97 |
| AC2 | Event translation covers all SDK event types | `tasks.md` translation matrix; `translateEvent()` implementation; synthetic runtime repro exposed the `tool.execution_complete` output gap | 68 |
| AC3 | Permission auto-approval implemented | `approveAll` wiring in `run()`, `compact()`, and `terminate()` | 84 |
| AC4 | `just fft` passes | `execution.log.md`; review reran `just fft` successfully | 99 |

**Overall coverage confidence**: 88%

## G) Commands Executed

```bash
git --no-pager diff --stat && printf '\n---STAGED---\n' && git --no-pager diff --staged --stat && printf '\n---LOG---\n' && git --no-pager log --oneline -10
mkdir -p /Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-3-sdk-adapter/reviews && git --no-pager diff --name-status df5c6b5..b8b6591 && printf '\n---DIFF---\n' && git --no-pager diff df5c6b5..b8b6591
git --no-pager diff df5c6b5..b8b6591 > /Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-3-sdk-adapter/reviews/_computed.diff
just fft
npm pack --dry-run --json
rg '@chainglass/' /Users/jordanknight/substrate/minih/src
rg 'workingDirectory' /Users/jordanknight/substrate/minih/node_modules/@github/copilot-sdk/dist
node --input-type=module <<'EOF'
# Loaded /Users/jordanknight/substrate/minih/dist/adapter/sdk-copilot.js with fake SDK clients to confirm:
# - session_start_emitted false
# - tool_result_payload {"toolCallId":"tc1","output":"short","isError":true}
# - compact_destroy_calls 0
# - create_has_working_directory false
EOF
```

## H) Handover Brief

> Copy this section to the implementing agent. It has no context on the review —
> only context on the work that was done before the review.

**Review result**: REQUEST_CHANGES

**Plan**: /Users/jordanknight/substrate/minih/docs/plans/001-setup/miniharness-extraction-plan.md
**Spec**: /Users/jordanknight/substrate/minih/docs/plans/001-setup/miniharness-extraction-spec.md
**Phase**: Phase 3: SDK Adapter
**Tasks dossier**: /Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-3-sdk-adapter/tasks.md
**Execution log**: /Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-3-sdk-adapter/execution.log.md
**Review file**: /Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-3-sdk-adapter/reviews/review.phase-3-sdk-adapter.md

### Files Reviewed

| File (absolute path) | Status | Domain | Action Needed |
|---------------------|--------|--------|---------------|
| /Users/jordanknight/substrate/minih/src/adapter/sdk-copilot.ts | Reviewed | adapter internal | FT-001, FT-002, FT-003, FT-004 |
| /Users/jordanknight/substrate/minih/src/adapter/copilot-types.ts | Reviewed | adapter contract | FT-002, FT-004 |
| /Users/jordanknight/substrate/minih/src/adapter/index.ts | Reviewed | adapter contract | None |
| /Users/jordanknight/substrate/minih/docs/domains/adapter/domain.md | Reviewed | adapter docs | FT-005 |
| /Users/jordanknight/substrate/minih/package.json | Reviewed | root/package | None |
| /Users/jordanknight/substrate/minih/package-lock.json | Reviewed | root/deps | None |
| /Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-3-sdk-adapter/tasks.md | Reviewed | phase artifact | Update after fixes |
| /Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-3-sdk-adapter/execution.log.md | Reviewed | phase artifact | Update after fixes |
| /Users/jordanknight/substrate/minih/docs/plans/001-setup/tasks/phase-3-sdk-adapter/tasks.fltplan.md | Reviewed | phase artifact | None |

### Required Fixes (if REQUEST_CHANGES)

| # | File (absolute path) | What To Fix | Why |
|---|---------------------|-------------|-----|
| 1 | /Users/jordanknight/substrate/minih/src/adapter/sdk-copilot.ts | Emit `session_start` immediately after session create/resume so the runner timeout path holds the real session ID before `sendAndWait()` begins. | Timed-out SDK runs currently call `terminate('')` instead of aborting the live session. |
| 2 | /Users/jordanknight/substrate/minih/src/adapter/copilot-types.ts; /Users/jordanknight/substrate/minih/src/adapter/sdk-copilot.ts | Add `workingDirectory` to the local Copilot config facade and pass `AgentRunOptions.cwd` through on create/resume. | Without it, SDK tool calls can run in the wrong directory when callers set `cwd`. |
| 3 | /Users/jordanknight/substrate/minih/src/adapter/sdk-copilot.ts | Preserve `detailedContent` and `error.message` when translating `tool.execution_complete`. | Failed or diff-heavy tool calls currently lose the useful output shown to users and logs. |
| 4 | /Users/jordanknight/substrate/minih/src/adapter/copilot-types.ts; /Users/jordanknight/substrate/minih/src/adapter/sdk-copilot.ts | Add the supported cleanup method to the local session facade and disconnect the resumed session after `compact()` completes. | Repeated compactions otherwise leak dropped-but-live session handles. |
| 5 | /Users/jordanknight/substrate/minih/docs/domains/adapter/domain.md | Update Composition, Contracts, and Concepts for `copilot-types.ts` and the expanded adapter facade surface. | Phase 3 domain docs are only partially updated. |

### Domain Artifacts to Update (if any)

| File (absolute path) | What's Missing |
|---------------------|----------------|
| /Users/jordanknight/substrate/minih/docs/domains/adapter/domain.md | Add `src/adapter/copilot-types.ts` to Composition; list `SdkCopilotAdapter`, `ICopilotClient`, `ICopilotSession`, `CopilotSessionConfig`, `CopilotResumeSessionConfig`, and `CopilotSessionEventLike` in Contracts; add a Concepts entry for the local Copilot SDK facade. |

### Next Step

/plan-6-v2-implement-phase --plan /Users/jordanknight/substrate/minih/docs/plans/001-setup/miniharness-extraction-plan.md --phase 'Phase 3: SDK Adapter'
