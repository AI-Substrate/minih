# Agent Permissions Implementation Plan

**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-05-04
**Spec**: [agent-permissions-spec.md](agent-permissions-spec.md)
**Status**: DRAFT

> ⚠️ Mode tension flagged in clarify: 35 ACs spanning 6 numbered releases is unusually large for Simple mode. The single-tasks table below is organised by **release ordinal R1-R6** as a logical grouping. Each release ordinal is a natural shipping boundary — implement R1 fully, ship, then R2, etc. If during execution the inline table becomes unwieldy, escalate by splitting into per-release dossiers via `/plan-5-v2-phase-tasks-and-brief --phase "Release N"`.
>
> **Escalation Triggers** (machine-readable — when any of these is true, escalate to per-release dossiers before proceeding):
> - Any single release's task count exceeds 25
> - Any single task's "Done When" needs to be split because it can't be reviewed as one commit
> - Cross-release dependency surfaces that the inline table can't express clearly
> - `code-review-companion` (Power-On-Mode reviewer) emits ≥3 HIGH findings on a single release's commits — signals the release is too big to review safely as one unit

---

## Summary

Replace minih's hard-coded `approveAll` permission posture (4 sites in `src/adapter/sdk-copilot.ts`) with a fine-grained, opt-in policy compiled from agent frontmatter. Authors declare a preset; the runner builds an SDK `PermissionHandler` plus a filesystem guard scoped to the user's git project. Permission denials are terminal — first-trigger-wins with a five-signal fail protocol that reuses the existing outside-inbox lane (plan 008+). Migration to safer defaults is staged across six releases (R1 schema → R6 universal flip) so no existing agent silently changes behaviour. **End-to-end validation via the `permission-prober` agent + `minih probe` orchestrator (workshop 004) — 10 parallel scenarios per release gate**. Phase 6 is opt-in stretch (`--strict-fs` + `permission_status` MCP tool); the rest are mandatory.

---

## Target Domains

| Domain | Status | Relationship | Role |
|---|---|---|---|
| `runner` | existing | **modify** | Owns the policy compiler, preset registry, FS guard, denial → status:failed path, outside-inbox `permission-error` append. New `src/runner/permissions/` subdirectory (5 new files). |
| `adapter` | existing | **modify** | Replaces 4× `approveAll` with policy-derived `PermissionHandler`. Emits new `AgentPermissionDeniedEvent`. Narrows `copilot-types.ts` `onPermissionRequest` signature. |
| `cli` | existing | **modify** | New `agent permissions` subcommand family + flags on `run`/`resume` + new doctor check + first-run banner + `agent install` interactive prompt. |
| `mcp` | existing | **modify** (R6 stretch only) | Phase 6 adds `permission_status` inside-MCP tool. No changes in R1-R5. |
| `agent-pack` (plan 017) | existing | **modify** | `agent.json` manifest 0.1.0 → 0.2.0 (`permissions.recommended` + `.fallback`). Sidecar `.minih-source.json` 0.1.0 → 0.2.0 (`lockedDefault` + reason fields). One-time idempotent backfill. |

**No new domains.** All work fits cleanly inside existing topology.

---

## Domain Manifest

| File | Domain | Classification | Rationale |
|---|---|---|---|
| `src/runner/permissions/policy.ts` | runner | contract (`PermissionPolicy`, `ResolvedPolicy` types) + internal (compile()) | NEW |
| `src/runner/permissions/presets.ts` | runner | internal | NEW — built-in preset registry |
| `src/runner/permissions/handler.ts` | runner | contract (`buildPermissionHandler` factory) | NEW |
| `src/runner/permissions/fs-guard.ts` | runner | internal | NEW |
| `src/runner/permissions/catalog.ts` | runner | internal (data for list-available) | NEW |
| `src/runner/permissions/index.ts` | runner | contract (re-exports) | NEW |
| `src/runner/folder.ts` | runner | internal | MODIFY — add `parsePermissionsField()` helper, extend `parseFrontmatter()` return shape |
| `src/runner/types.ts` | runner | contract | MODIFY — extend `AgentDefinition` with `permissions?`; extend `AgentRunConfig` with `allowedRoots?`, `permissionsOverride?` |
| `src/runner/runner.ts` | runner | internal | MODIFY — resolve policy, build handler, plumb to adapter; on `permission_denied` short-circuit (5-signal protocol) |
| `src/runner/coordination/permission-error.ts` (or in existing helper) | runner | internal | NEW — `appendPermissionError()` helper that wraps existing `appendInboxMessage` |
| `src/schemas/permission-policy.json` | runner | contract | NEW — JSON Schema for frontmatter form |
| `src/schemas/permission-error.json` | runner | contract | NEW — JSON Schema for outside-inbox message shape |
| `src/adapter/events.ts` | adapter | contract | MODIFY — add `AgentPermissionDeniedEvent` to AgentEvent union; add `permissionHandler?` to `AgentRunOptions` |
| `src/adapter/copilot-types.ts` | adapter | contract | MODIFY — narrow `onPermissionRequest` signature to real `PermissionHandler` shape |
| `src/adapter/sdk-copilot.ts` | adapter | internal | MODIFY — replace 4× `approveAll` with `options.permissionHandler ?? approveAll`; emit `permission_denied` events |
| `src/cli/commands/agent.ts` | cli | internal | MODIFY — add `permissions` subcommand family (`list-available`, `list`, `set`, `clear`, `migrate`); update `install` interactive flow + non-interactive flags |
| `src/cli/commands/run.ts` | cli | internal | MODIFY — `--permissions`, `--allowed-roots`, `--allowed-roots-only`, `--strict-fs`, `--dry-run-permissions` flags; first-run banner check |
| `src/cli/commands/resume.ts` | cli | internal | MODIFY — same flag set (re-resolves policy on resume) |
| `src/cli/commands/doctor.ts` | cli | internal | MODIFY — `permissions` check (warning when missing) |
| `src/cli/commands/init.ts` | cli | internal | MODIFY — R5+ scaffold writes `permissions: restricted` |
| `src/runner/agent-pack/install.ts` | agent-pack (in runner) | internal | MODIFY — write `lockedDefault` to sidecar at install; one-time backfill on read |
| `src/runner/agent-pack/manifest.ts` | agent-pack | contract | MODIFY — manifest 0.2.0 schema with `permissions.recommended` + `.fallback`; backward-compat read for 0.1.0 |
| `agents/code-review-companion/agent.json` | agent-pack | data | MODIFY — bump manifest 0.2.0; add `permissions.recommended: read-only`, `permissions.fallback: restricted`, `permissions.rationale: '...'` |
| `agents/code-review-companion/prompt.md` | agent-pack | data | MODIFY — add `permissions: { preset: read-only, overrides: { network: allow, shell: allow } }` |
| `agents/{code-review,convention-check,coordination-loop-validator,coordination-smoke-test,demo-companion,feedback-digest,first-time-experience,hello-world,mcp-smoke-test,prompt-review,self-review,smoke-test}/prompt.md` | agent-pack | data | MODIFY — add explicit `permissions:` per heuristic recommendation (12 agents) |
| `src/mcp/tools/permission-status.ts` | mcp | contract | NEW — Phase 6 stretch only |
| `src/mcp/tools/index.ts` | mcp | internal | MODIFY (Phase 6 only) — register new tool |
| `test/runner/permissions/*.test.ts` | runner | tests | NEW — policy, presets, fs-guard, handler, runner-denies, preset-end-to-end |
| `test/runner/folder-permissions-frontmatter.test.ts` | runner | tests | NEW |
| `test/cli/agent-permissions.test.ts` | cli | tests | NEW |
| `test/cli/doctor-permissions.test.ts` | cli | tests | NEW |
| `test/agents/permissions-explicit.test.ts` | runner | tests | NEW (R4+ regression gate) |
| `test/runner/agent-pack/lockeddefault-backfill.test.ts` | runner | tests | NEW |
| `test/runner/agent-pack/companion-manifest.test.ts` | runner | tests | MODIFY — 0.2.0 baseline snapshot |
| `test/cli/agent-list-baseline.test.ts` | cli | tests | MODIFY — companion frontmatter snapshot |
| `docs/how/permissions.md` | docs | data | NEW (~600 LOC) |
| `docs/how/companion-mode.md` | docs | data | MODIFY — link to permissions ref |
| `AGENTS_README.md` | docs | data | MODIFY — § Permissions section; rebuild dist |
| `README.md` | docs | data | MODIFY — § Permissions one-paragraph |
| `docs/domains/runner/domain.md` | docs | data | MODIFY — Concepts table + History row |
| `docs/domains/adapter/domain.md` | docs | data | MODIFY — History row |
| `docs/domains/cli/domain.md` | docs | data | MODIFY — Composition + History |
| `docs/domains/mcp/domain.md` | docs | data | MODIFY — Phase 6 only |
| `docs/plans/018-agent-permissions/fixes/FX001-permissions-reset.md` | docs | data | NEW — deferred |
| `docs/plans/018-agent-permissions/fixes/FX002-permissions-check.md` | docs | data | NEW — deferred |
| `docs/plans/018-agent-permissions/fixes/FX003-doctor-severity.md` | docs | data | NEW — deferred |
| `docs/plans/018-agent-permissions/fixes/FX004-prober-outside-readback.md` | docs | data | NEW — deferred (workshop 004 § Q10) |
| `docs/plans/018-agent-permissions/fixes/FX008-coordination-write-precondition.md` | docs | data | NEW — proposed (issue #25; ships today) |
| `docs/plans/018-agent-permissions/fixes/FX009-status-pid-probe.md` | docs | data | NEW — proposed (issue #24; ships today) |
| `docs/plans/018-agent-permissions/fixes/FX010-restricted-output-auto-narrow.md` | docs | data | NEW — deferred (issue #25 suggested fix #1) |
| `docs/plans/018-agent-permissions/fixes/FX011-minih-reconcile.md` | docs | data | NEW — deferred (issue #24 split) |
| `docs/plans/018-agent-permissions/fixes/FX012-provider-stream-aborted.md` | docs | data | NEW — deferred (issue #24 observability) |
| `agents/permission-prober/{prompt.md,instructions.md,input-schema.json,output-schema.json,scenarios.json,agent.json}` | agent-pack | data + contract (output-schema.json is the report contract) | NEW — workshop 004 prober pack |
| `src/cli/commands/probe.ts` | cli | internal | NEW — `minih probe` orchestrator |
| `src/runner/probe/aggregator.ts` | runner | internal | NEW — claim-vs-truth cross-reference; UNTRUSTWORTHY detection |
| `src/runner/probe/types.ts` | runner | contract (`MatrixResult`, `MatrixCell`, `ProberReport`) | NEW |
| `test/cli/probe.test.ts` | cli | tests | NEW — smoke + 1-scenario fixture |
| `test/runner/probe/aggregator.test.ts` | runner | tests | NEW — truth-cross-reference unit tests |

---

## Key Findings

| # | Impact | Finding | Action |
|---|---|---|---|
| 01 | Critical | SDK has the entire permission engine — 8 kinds, 5 decision shapes, allowlist/denylist. Implementation is *surface*, not *engine*. Pin every shape name in our policy types. | Tasks T-R1.1 (types) + T-R1.13 (SDK shape regression test) lock the SDK contract names. |
| 02 | High | Permission denial isn't a typed event today; SDK emits `tool_result isError:true` regardless. Runner can't distinguish "tool failed" from "denied." | T-R1.7 adds `AgentPermissionDeniedEvent`; adapter tracks `deniedRequestIds` Set in handler closure (T-R1.6). |
| 03 | High | `allowedRoots` cannot reuse `workingDirectory` (workshop 005 reserves it for SDK session isolation). Need separate concept resolved at CLI/runner entry. | T-R1.4 resolves `allowedRoots` from invocation cwd via git-walk; T-R1.5 implements canonicalize + multi-source merge. |
| 04 | High | The "tell outside it failed" channel already exists (plan 008+ outside inbox). Just need a new typed message. | T-R1.10 defines `permission-error` schema + helper that wraps existing `appendInboxMessage`. |
| 05 | High | Manifest 0.1.0 → 0.2.0 bump in plan 017's snapshot test will need re-baseline. The companion manifest test (`companion-manifest.test.ts`) is the canonical reference. | T-R3.5 + T-R3.6 update the baseline together; companion frontmatter migration in T-R4.1 cross-checks. |
| 06 | High | Companion preset `read-only + network: allow` may need broader override than expected because `gh` is a shell tool. Verify by running real review-request fixture before declaring success. | T-R4.1 includes a regression fixture (per AC35) that runs the companion against a fake gh-using flow; if `network: allow` alone fails, escalate override to also include `shell: allow` on a tight allowlist. |
| 07 | Critical | Default-flip at R6 is irreversible without R7. The 4-week dwell at R5 + 3-of-3 internal gates green is a judgment call documented in R6 release notes. | T-R6.5 captures the gate evidence in R6 release-notes draft; do not ship R6 until evidence is documented. |
| 08 | High | First-party agent migration in R4 is a flag-day for fft. Regression test (`permissions-explicit.test.ts`) gated to fft IS the gate that proves R4 is complete. | T-R4.2 ships the test; it MUST pass before R4 is declared done. |
| 09 | High | Unit tests prove pieces; only a live SDK session proves the gates fire end-to-end. Workshop 004 designs a parameterised `permission-prober` agent + `minih probe` orchestrator that fires N scenarios in parallel with claim-vs-truth cross-referencing. | T-R2.12+T-R2.13 build the prober pack + CLI; T-R3.9/T-R4.10/T-R6.6 grow scenarios per release; gate evidence per release captures matrix.html. |

---

## Harness Strategy

**Not applicable** — user override (Q8 in clarify session). Existing `just fft` pipeline (`lint → format → build → typecheck → test → audit`) plus companion-mode review (Power-On-Mode) covers Boot/Interact/Observe roles for this work. Companion-mode is itself touched by Phase 5 migration; runs as the live reviewer during implementation.

---

## Implementation

**Objective**: Ship the agent permissions feature across six numbered minor-version releases, each individually reversible, ending with `restricted` as the universal default.

**Testing Approach**: Hybrid (per spec § Clarifications)
- TDD for security-critical core: policy compiler, FS guard, PermissionHandler, runner short-circuit
- Lightweight for CLI subcommand wiring, doctor warnings, first-run banner
- Manual verification for cross-release time-travel fixture chain
- Mock policy: targeted — real symlink fixtures in `tmpdir()` for FS guard; SDK mocked at adapter boundary (mirrors existing `FakeAgentAdapter`)

**Rollout shape**: Tasks tagged with target release (R1-R6). Each release is a natural shipping boundary — finish all tasks for R1 before opening any R2 work. Phase 6 (R6 stretch) tasks are clearly separated and can ship independently of the rollout.

---

### Tasks — Release 1 (Schema arrives, no behaviour change)

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|---|---|---|---|---|---|---|
| [ ] | T-R1.1 | Define `PermissionPolicy`, `ResolvedPolicy`, `PermissionKind`, `AllowedRootsRule`, `PermissionOverrides` types | runner | `/Users/jordanknight/substrate/minih/src/runner/permissions/policy.ts` | TS compiles; types exported via `src/runner/permissions/index.ts`; finding 01 SDK shape names pinned as string literal unions | TDD: write type-level tests first (`expectTypeOf`) |
| [ ] | T-R1.2 | Build six-preset registry with kind-decision matrix per workshop 001 § Schema | runner | `src/runner/permissions/presets.ts` | All 6 presets (yolo/trusted/restricted/read-only/network/build-only) export; `getPreset(name)` throws on unknown; baseline snapshot test prevents accidental loosening | TDD: snapshot the kind-decision matrix per preset |
| [ ] | T-R1.3 | Hand-roll `parsePermissionsField()` mirroring existing `parseCoordinationField()` shape | runner | `src/runner/folder.ts` | Recognises string form (`permissions: yolo`) AND object form (`permissions: { preset: ..., overrides: {...}, allowedRoots: {...} }`); throws `InvalidPermissionsFrontmatterError` on bad shape; CRLF-safe per PL-01 | TDD: parameterised test fixtures covering every documented form + 6 invalid shapes |
| [ ] | T-R1.4 | Implement `resolveDefaultAllowedRoots(cwd)` per workshop 001 § Q2 algorithm (git-root walk + worktree handling + cwd fallback) | runner | `src/runner/permissions/fs-guard.ts` | Returns `{roots, reason}` for each scenario in workshop 001's edge case table; tests cover bare repo, submodule, worktree, no-git, $HOME (warning), `/` (refuse) | TDD: real .git fixtures via `tmpdir()` |
| [ ] | T-R1.5 | Implement `canonicalizeRoots()` + multi-source merge with `extend`/`replace` modes per workshop 001 § Q5 | runner | `src/runner/permissions/fs-guard.ts` | Four-source composition (harness/frontmatter/env/CLI) produces deterministic deduped canonical list; replace mode wipes lower layers; forbidden-root denylist refuses with clear error | TDD: composition matrix tests per Q5 worked example |
| [ ] | T-R1.6 | Implement `isPathAllowed()` with per-access realpath; handle ENOENT (write-to-new-file) by realpathing the parent dir | runner | `src/runner/permissions/fs-guard.ts` | Every escape pattern from workshop 001 § Q3 (symlink-out, `..` traversal, ENOENT-write, ELOOP, broken target) handled correctly; passes for in-roots paths | TDD: real symlink trees in tmpdir; cleaned up via `afterEach` |
| [ ] | T-R1.7 | Build `extractPathArg()` heuristic for path-bearing tool args (JSON Schema `format: path`, name patterns `*Path`/`*Dir`/`cwd`) | runner | `src/runner/permissions/fs-guard.ts` | Recognises shell/write/read tool args; returns `null` for non-path-bearing tools; documented limitations match workshop 001 § Q7 | TDD: fixtures per known SDK tool args |
| [ ] | T-R1.8 | Build `compile(rawPolicy, sources)` → `ResolvedPolicy` (preset → decisions; merge overrides; canonicalize roots; record `rootsResolvedFrom` provenance) | runner | `src/runner/permissions/policy.ts` | Resolution chain matches AC24 exactly: frontmatter → sidecar → env → release-default; provenance map populated for every root | TDD: 4-layer override matrix tests |
| [ ] | T-R1.9 | Build `buildPermissionHandler(resolved, onDeny)` factory producing SDK-shape `PermissionHandler` | runner | `src/runner/permissions/handler.ts` | Returns `{kind: 'approve-once'}` for allowed kinds + in-roots paths; `{kind: 'reject', feedback: '...'}` otherwise; idempotent on requestId via Set | TDD: decision matrix test (kind × decision × path) |
| [ ] | T-R1.10 | Define `AgentPermissionDeniedEvent` and add to `AgentEvent` union | adapter | `src/adapter/events.ts` | Event type compiles; `AgentRunOptions.permissionHandler?` field added (optional for back-compat) | Type-only; TDD via `expectTypeOf` |
| [ ] | T-R1.11 | Narrow `copilot-types.ts` `onPermissionRequest` to real `PermissionHandler` signature (was `() => {kind: string}`) | adapter | `src/adapter/copilot-types.ts` | Compiles; tests in `test/adapter/sdk-copilot.test.ts` still pass with new shape | Lightweight: type narrowing surfaces hidden assumptions |
| [ ] | T-R1.12 | Replace 4× `approveAll` constant in `sdk-copilot.ts` with `options.permissionHandler ?? approveAll` (createSession + resumeSession × 2 sites) | adapter | `src/adapter/sdk-copilot.ts` | Existing tests pass unchanged (no `permissionHandler` passed = identical behaviour); new test verifies handler is invoked when passed | TDD: handler-injection test |
| [ ] | T-R1.13 | Track `deniedRequestIds: Set<string>` in handler closure; emit `permission_denied` event when handler returns reject; idempotent on requestId | adapter | `src/adapter/sdk-copilot.ts` | Same denial firing twice produces one event; event payload matches workshop 002 schema | TDD: idempotency + payload-shape tests |
| [ ] | T-R1.14 | SDK shape regression test: instantiate every PermissionDecision kind name + PermissionRequest kind name; fail loudly if SDK 0.4 renames anything | adapter | `test/adapter/sdk-permission-shapes.test.ts` | Test runs in CI; failure clearly points at the renamed name | Per finding 01 |
| [ ] | T-R1.15 | Define `permission-error.json` JSON Schema (workshop 002 § Q6 contract; `meta.contractVersion: 1`) | runner | `src/schemas/permission-error.json` | Validates the example payload; copied to dist via existing `scripts/copy-schemas.js` | Lightweight |
| [ ] | T-R1.16 | Define `permission-policy.json` JSON Schema for frontmatter form | runner | `src/schemas/permission-policy.json` | Validates 6 fixture frontmatter shapes (each preset, each composition mode); rejects 6 invalid shapes | Lightweight |
| [ ] | T-R1.17 | Wire policy compilation into `runAgent()`: load, resolve, build handler, plumb to `AgentRunOptions.permissionHandler` | runner | `src/runner/runner.ts` | Existing tests still green (no behaviour change for un-migrated agents); a new agent fixture with `permissions: read-only` resolves correctly through the pipeline | TDD: end-to-end runner-event-driven test with restricted preset |
| [ ] | T-R1.18 | Implement five-signal denial protocol per workshop 002 § Q1: events.ndjson + run.json (mandatory), inside-state + outside-inbox (best-effort, coordinated only) | runner | `src/runner/runner.ts` + new `src/runner/permissions/error-signal.ts` | Order matches workshop 002; `terminalFired` mutex enforces first-trigger-wins; coordination signals failures recorded in `run.json.coordinationSignals` not thrown | TDD: each signal independently failable; integration test for full chain |
| [ ] | T-R1.19 | Add new error codes to `ErrorCodes` enum: `E200 PERMISSION_DENIED`, `E201 ALLOWED_ROOTS_INVALID`, `E202 FORBIDDEN_ROOT`, `E203 PERMISSIONS_FRONTMATTER_INVALID`, `E204 PERMISSION_PRESET_UNKNOWN` | cli | `src/cli/output.ts` | All codes exported; doctor & migrate use them | Lightweight |
| [ ] | T-R1.20 | Document § Permissions in `docs/how/permissions.md` (full reference: presets, FS guard, threat model with TOCTOU honesty, error codes E200-E204) | docs | `/Users/jordanknight/substrate/minih/docs/how/permissions.md` | Renders cleanly; cross-links from companion-mode.md and AGENTS_README; covers AC34 (config-discovery exemption) | Lightweight |
| [ ] | T-R1.20a | Executable regression for AC34: agent with `permissions: read-only` + `allowedRoots: [/repo]` + `enableConfigDiscovery: true` loads `AGENTS.md` from `~` without firing `permission_denied` | runner | `test/runner/permissions/config-discovery-exemption.test.ts` | Test passes; no denial event observed; failure clearly identifies "config discovery hit FS guard" | TDD; lifts AC34 from docs-only to enforced |
| [ ] | T-R1.21 | Update `docs/domains/{runner,adapter}/domain.md` with R1 history row + new Concepts entries for `runner` (Permissions concept group) | docs | `docs/domains/runner/domain.md`, `docs/domains/adapter/domain.md` | History rows added with date; runner Concepts table has new "Permissions" group with policy/presets/handler/fs-guard | Lightweight |
| [ ] | T-R1.22 | `just fft` green; tag R1 release | — | — | All R1 tests pass; `just fft` green; CHANGELOG entry "R1 introduces permissions: frontmatter (no behaviour change)" | Manual verification |

---

### Tasks — Release 2 (Doctor warns; CLI tooling lands)

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|---|---|---|---|---|---|---|
| [ ] | T-R2.1 | Build `agent permissions list-available` subcommand | cli | `src/cli/commands/agent.ts`, `src/runner/permissions/catalog.ts` | Prints all 6 presets with kind-decision matrix + descriptions; `--json` produces machine-readable output | Lightweight test |
| [ ] | T-R2.2 | Build `agent permissions list <slug>` and `agent permissions list <slug> --effective` subcommands | cli | `src/cli/commands/agent.ts` | `list` shows raw frontmatter policy; `--effective` shows resolved policy after all override layers applied | Lightweight test |
| [ ] | T-R2.3 | Build `agent permissions set <slug> <preset>` and `agent permissions clear <slug>` (frontmatter writers — idempotent) | cli | `src/cli/commands/agent.ts` | Set is idempotent (re-running same preset = no diff); clear removes the field cleanly | Lightweight test |
| [ ] | T-R2.4 | Build `agent permissions migrate <slug> [--preset NAME] [--dry-run]` with heuristic recommendation per workshop 003 § Q6 | cli | `src/cli/commands/agent.ts` | Heuristic table from workshop 003 implemented (tags review/companion → read-only; build/lint → trusted; etc.); dry-run shows diff + reasoning; non-interactive `--yes` auto-accepts | Lightweight test for each heuristic branch |
| [ ] | T-R2.5 | Build `agent permissions migrate --all [--dry-run] [--yes]` bulk-migrate command | cli | `src/cli/commands/agent.ts` | Iterates every agent without explicit `permissions:`; with `--yes` applies recommendations + prints diff per agent; non-zero exit on any single failure | Lightweight test against fixture agents dir |
| [ ] | T-R2.6 | Add `--permissions <preset>`, `--allowed-roots <p1,p2>`, `--allowed-roots-only <p1,p2>`, `--strict-fs`, `--dry-run-permissions` flags to `minih run` | cli | `src/cli/commands/run.ts` | Each flag plumbs into `AgentRunConfig`; `--dry-run-permissions` resolves and prints policy without running | Lightweight test per flag |
| [ ] | T-R2.7 | Add same flag set to `minih resume` (re-resolves policy on resume per AC31) | cli | `src/cli/commands/resume.ts` | Re-resolves fresh; `run.json.resumes[].previousTerminalReason: 'permission-denied'` recorded if applicable | Lightweight |
| [ ] | T-R2.8 | Add doctor `permissions` check (warning when missing field; pass when explicit; passes through `permissions: yolo` cleanly) | cli | `src/cli/commands/doctor.ts` | Severity matches workshop 003 § Q5 ramp; `--strict` makes warnings fail; message includes migration command pointer | Lightweight test on fixture agents |
| [ ] | T-R2.9 | Implement `MINIH_PERMISSIONS_DEFAULT` env var + stderr banner when set (yellow, prints on every `minih run`) | runner+cli | `src/runner/runner.ts`, `src/cli/commands/run.ts` | Env var overrides implicit default per AC25; banner prints whenever non-empty; invalid values refuse to start | TDD on resolution chain; lightweight on banner |
| [ ] | T-R2.10 | Implement first-run banner via `~/.minih/last-seen-version` detection; `MINIH_NO_FIRST_RUN_BANNER=1` and `~/.minih/permissions-acknowledged` suppress | cli | `src/cli/commands/run.ts` (banner inline; extract to helper if it grows) | Banner prints once per version bump; suppression flags work | Lightweight |
| [ ] | T-R2.11 | Update CHANGELOG with R2 entry; tag release | docs | `CHANGELOG.md` | "R2: doctor warns on un-migrated agents; agent permissions CLI ships; MINIH_PERMISSIONS_DEFAULT escape hatch" | Manual |
| [ ] | T-R2.12 | Author `agents/permission-prober/` agent pack (prompt + instructions + schemas + first 4 scenarios — yolo, restricted, read-only, network) per workshop 004 | agent-pack | `agents/permission-prober/{prompt.md,instructions.md,input-schema.json,output-schema.json,scenarios.json,agent.json}` | Single-scenario `minih run permission-prober --params scenario=restricted-default --params nonce=test` produces a valid output report; agent's own frontmatter migrated to `permissions: read-only + overrides` per workshop 004 § Q7 | Companion-mode review |
| [ ] | T-R2.13 | Build `minih probe --matrix all`/`--scenario`/`--ci` CLI command + aggregator (parallel orchestrator that cross-references reports against `events.ndjson` + `run.json` truth surfaces) | cli + runner | `src/cli/commands/probe.ts`, `src/runner/probe/aggregator.ts`, `src/runner/probe/types.ts` | All 4 R2-applicable scenarios pass; aggregator detects UNTRUSTWORTHY mismatches (test fixture); matrix.html renders; nonce + schema verification gates report trust | TDD aggregator; lightweight CLI |

---

### Tasks — Release 3 (Pack install captures intent)

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|---|---|---|---|---|---|---|
| [ ] | T-R3.1 | Bump manifest `0.1.0` → `0.2.0`; add `permissions.recommended`, `.fallback`, `.rationale` fields to schema; backward-compat read for 0.1.0 manifests | agent-pack | `src/runner/agent-pack/manifest.ts` | Schema validates both 0.1.0 (legacy) and 0.2.0 inputs; type narrowing distinguishes; existing `companion-manifest.test.ts` baseline updated | TDD: snapshot baseline |
| [ ] | T-R3.2 | Extend `.minih-source.json` sidecar with `lockedDefault`, `lockedDefaultRecordedAt`, `lockedDefaultReason` fields | agent-pack | `src/runner/agent-pack/install.ts` | New installs write all three fields per workshop 003 § Q3 table; reason values match exact strings | TDD |
| [ ] | T-R3.3 | One-time idempotent backfill: first read of any sidecar without `lockedDefault` writes `yolo` + `pre-schema-install-grandfathered`. **Lossless-preservation invariant**: a sidecar that already carries `lockedDefault` is NEVER overwritten or modified by any later release (R4-R6); the only legitimate path to changing a `lockedDefault` is an explicit user `agent install` upgrade or `agent permissions reset` (deferred FX001). | agent-pack | `src/runner/agent-pack/install.ts` (or new helper) | Backfill is idempotent; timestamp recorded once; never re-writes; lossless-preservation enforced by test (write sidecar, run R4/R5/R6 binary, assert no field mutation) | TDD: write-then-read fixture + lossless invariant test |
| [ ] | T-R3.4 | Build interactive `[A]ccept / [F]allback / [Y]olo / [C]ancel` prompt for `agent install` when manifest has `permissions.recommended` | cli | `src/cli/commands/agent.ts` | Interactive flow per workshop 003 § Q6; non-interactive flags map: `--yes` (accept), `--yes --no-recommended` (fallback), `--yes --permissions yolo` (override), `--accept-recommended-permissions` (accept w/o full --yes) | Lightweight test |
| [ ] | T-R3.5 | Resolution chain wired in `runAgent`: frontmatter → sidecar `lockedDefault` → env var → `minihReleaseDefault` per AC24 | runner | `src/runner/runner.ts`, `src/runner/permissions/policy.ts` | All four positions independently exercised by fixture; chain order matches workshop 003 | TDD: 4-position fixture matrix |
| [ ] | T-R3.6 | Update `companion-manifest.test.ts` baseline for 0.2.0 schema (companion's recommended is set in T-R4.1 — this task is the test gate) | agent-pack | `test/runner/agent-pack/companion-manifest.test.ts` | Snapshot reflects 0.2.0 manifest with recommended/fallback fields | Lightweight |
| [ ] | T-R3.7 | New regression test: `lockeddefault-backfill.test.ts` covering pre-schema sidecar + R3 binary | runner | `test/runner/agent-pack/lockeddefault-backfill.test.ts` | First-read backfill is idempotent; second read no-ops; sidecar fields validated | TDD |
| [ ] | T-R3.8 | Update CHANGELOG with R3 entry; tag release | docs | `CHANGELOG.md` | "R3: agent install captures recommended permissions; existing packs grandfathered" | Manual |
| [ ] | T-R3.9 | Extend `agents/permission-prober/scenarios.json` with #5 (trusted-fs-escape) + #6 (restricted-coordinated) | agent-pack | `agents/permission-prober/scenarios.json` | Both scenarios PASS via `minih probe --scenario trusted-fs-escape` and `minih probe --scenario restricted-coordinated`; matrix gate now covers FS guard + coordinated outside-inbox flow | Lightweight; data-only |

---

### Tasks — Release 4 (Internal agents migrated)

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|---|---|---|---|---|---|---|
| [ ] | T-R4.1 | Migrate `agents/code-review-companion/prompt.md` to `permissions: { preset: read-only, overrides: { network: allow, shell: allow } }` per AC35 + agent.json `permissions.recommended: read-only` | agent-pack | `agents/code-review-companion/{prompt.md,agent.json}` | Companion runs against a real review-request fixture without `permission_denied` events; if `network: allow` alone fails (gh is shell), expand override (logged + AC35 covers verification) | Verify with live companion-mode boot during finger 6 |
| [ ] | T-R4.2 | Add fft-blocking regression test `permissions-explicit.test.ts` asserting every `agents/*/prompt.md` (excluding `_shared/`) has explicit `permissions:` | runner | `test/agents/permissions-explicit.test.ts` | Test passes after T-R4.3; fails on `agents/` if any new agent omits the field | TDD: this IS the gate per finding 08 |
| [ ] | T-R4.3 | Migrate the remaining 12 internal agents per heuristic recommendation: `code-review`, `convention-check`, `coordination-loop-validator`, `coordination-smoke-test`, `demo-companion`, `feedback-digest`, `first-time-experience`, `hello-world`, `mcp-smoke-test`, `prompt-review`, `self-review`, `smoke-test` | agent-pack | `agents/*/prompt.md` (12 files) | Each agent has explicit `permissions:`; heuristic per workshop 003 (`migrate <slug> --dry-run` to inspect, then apply); test T-R4.2 green | Use `migrate` command itself; manually review each diff |
| [ ] | T-R4.4 | Update `agents/code-review-companion/agent.json` snapshot in `agent-list-baseline.test.ts` | agent-pack | `test/cli/agent-list-baseline.test.ts` | Snapshot reflects new permissions field; `MINIH_REGRESSION=1 npm test` green | Lightweight |
| [ ] | T-R4.5 | Update `AGENTS_README.md` with § Permissions section; rebuild dist via `scripts/copy-schemas.js` | docs | `AGENTS_README.md`, `dist/AGENTS_README.md` | `diff AGENTS_README.md dist/AGENTS_README.md` shows zero diff after build; section covers preset shortlist, overrides, allowedRoots, gotchas | Lightweight; per memory `AGENTS_README.md is bundled to dist` |
| [ ] | T-R4.6 | Update `README.md` § Permissions one-paragraph subsection | docs | `README.md` | Visible from top; links to `docs/how/permissions.md` | Lightweight |
| [ ] | T-R4.7 | Update `docs/how/companion-mode.md` with permissions cross-reference | docs | `docs/how/companion-mode.md` | Companion's `permissions: read-only + overrides` is shown as the canonical example | Lightweight |
| [ ] | T-R4.8 | Update `docs/domains/{runner,adapter,cli}/domain.md` with R3+R4 history rows (the agent-pack module lives inside runner — no separate `docs/domains/agent-pack/` exists; runner.md gets the agent-pack history row) | docs | `docs/domains/runner/domain.md`, `docs/domains/adapter/domain.md`, `docs/domains/cli/domain.md` | History rows added; cli Composition table updated with new subcommands | Lightweight |
| [ ] | T-R4.9 | Update CHANGELOG with R4 entry; tag release | docs | `CHANGELOG.md` | "R4: all first-party agents now declare permissions explicitly" | Manual |
| [ ] | T-R4.10 | Extend `agents/permission-prober/scenarios.json` with #7-#10 (network-preset, env-override, implicit-default-yolo, implicit-default-restricted) — full 10-scenario matrix | agent-pack | `agents/permission-prober/scenarios.json` | All 10 scenarios PASS via `minih probe --matrix all --ci`; pre-tag gate captures matrix.html as release evidence | Lightweight; data-only |

---

### Tasks — Release 5 (Default flips for new agents only)

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|---|---|---|---|---|---|---|
| [ ] | T-R5.1 | `minih init <slug>` writes `permissions: restricted` into scaffolded `prompt.md` frontmatter | cli | `src/cli/commands/init.ts` (template assembled inline) | New agent scaffolds carry the field; existing agents unaffected | Lightweight test |
| [ ] | T-R5.2 | `minih agent install` (without manifest recommendation OR with explicit decline + no fallback) writes `lockedDefault: restricted` instead of `yolo` for *new* installs in R5+ | agent-pack | `src/runner/agent-pack/install.ts` | New installs from R5+ get `lockedDefault: restricted` when no recommendation; existing sidecars unchanged | TDD: install-flow matrix |
| [ ] | T-R5.3 | Update CHANGELOG with R5 entry; tag release; begin 4-week dwell clock | docs | `CHANGELOG.md` | "R5: new agents default to restricted; existing agents preserved via lockedDefault" | Manual |

---

### Tasks — Release 6 (Universal default flip — gated)

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|---|---|---|---|---|---|---|
| [ ] | T-R6.1 | Flip `minihReleaseDefault` constant from `'yolo'` to `'restricted'` | runner | `src/runner/permissions/presets.ts` (or `defaults.ts`) | Constant flipped; sidecar `lockedDefault` overrides take precedence per AC30; agents without sidecar AND without env-var get `restricted` | TDD: end-to-end resolution test with cleared sidecar |
| [ ] | T-R6.2 | Doctor banner at R6: louder explanation of the flip; suggests migration command | cli | `src/cli/commands/doctor.ts` | Per workshop 003 § Q5 — severity stays `warning` (per OQ7 resolution) but message updated | Lightweight |
| [ ] | T-R6.3 | First-run banner updated for R6 release notes; references migration command | cli | `src/cli/commands/run.ts` | One-time banner explains what changed | Lightweight |
| [ ] | T-R6.4 | Cross-release time-travel regression: fixtures from R3 era sidecar + R6 binary produce identical behaviour for grandfathered agents | runner | `test/runner/permissions/time-travel-regression.test.ts` | R3-era sidecar (`lockedDefault: yolo`) loaded by R6 binary still resolves to `yolo` for that agent | TDD: AC32 |
| [ ] | T-R6.5 | Document gate evidence in R6 release notes: 3-of-3 internal gates green + R5 dwell ≥ 4 weeks + permissions-explicit.test.ts passing on fresh checkout + **`minih probe --matrix all --ci` green** | docs | release notes draft (gh release create) | Evidence list explicit; decision attributable; matrix.html attached | Manual; finding 07 |
| [ ] | T-R6.6 | Re-run `minih probe --matrix all --ci` against R6 binary; verify scenario #10 (implicit-default-restricted) passes (was expected to fail under R5 binary) | agent-pack | `agents/permission-prober/scenarios.json` (no change; just re-run gate) | Probe matrix all green under R6 binary; scenario #10 flips from FAIL (R5) to PASS (R6); gate evidence captured per workshop 003 § Q8 | Manual; finding 07 |

---

### Tasks — Phase 6 (Stretch — independent of rollout)

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|---|---|---|---|---|---|---|
| [ ] | T-S1 | Implement `createSessionFsHandler` provider for `--strict-fs` mode (Layer-(b) FS sandbox) | runner | `src/runner/permissions/fs-handler.ts` | Provider intercepts every SDK fs op; denies anything outside `canonicalRoots`; opt-in via flag | TDD; perf benchmark added to fft |
| [ ] | T-S2 | Register `permission_status` MCP tool inside the inside-MCP server (always-allowed; returns resolved policy as JSON). **Existing inside-MCP tools (`inbox_*`, `state_*`, `wait_*`) remain exempt from FS guard and unchanged — only `permission_status` is added.** | mcp | `src/mcp/tools/permission-status.ts`, `src/mcp/tools/index.ts` | Coordinated agents can call without triggering perm request; output matches AC33 shape; `inbox_*`/`state_*`/`wait_*` tool registrations untouched | TDD; passes against `restricted` agent fixture |
| [ ] | T-S3 | Document strict-fs in `docs/how/permissions.md` § Strict FS Mode | docs | `docs/how/permissions.md` | Includes opt-in instructions + perf trade-off note | Lightweight |
| [ ] | T-S4 | Document `permission_status` tool in AGENTS_README inside-MCP section | docs | `AGENTS_README.md`, `dist/AGENTS_README.md` | Rebuild + zero-diff verified | Lightweight |

---

### Tasks — Deferred Follow-Up Dossiers

| Status | ID | Task | Path | Done When |
|---|---|---|---|---|
| [x] | T-FX1 | Author `FX001-permissions-reset.md` — `minih agent permissions reset <slug>` clears sidecar `lockedDefault` (per OQ4) **+ unified audit-trail for all permissions edits (top-10 #2/#8)** | `docs/plans/018-agent-permissions/fixes/FX001-permissions-reset.md` | Dossier exists with motivation, scope, ACs |
| [x] | T-FX2 | Author `FX002-permissions-check.md` — `minih agent permissions check <slug>` dry-runs and records attempted denials (per OQ6) | `docs/plans/018-agent-permissions/fixes/FX002-permissions-check.md` | Dossier exists |
| [x] | T-FX3 | Author `FX003-doctor-severity.md` — `--strict-permissions` opt-in bridge (top-10 #6) + escalate doctor severity at R6+N if user feedback warrants (per OQ7) | `docs/plans/018-agent-permissions/fixes/FX003-doctor-severity.md` | Dossier exists |
| [x] | T-FX4 | Author `FX004-prober-outside-readback.md` — additional prober scenarios that validate outside-CLI rendering of `permission-error` lines (per workshop 004 § Q10) | `docs/plans/018-agent-permissions/fixes/FX004-prober-outside-readback.md` | Dossier exists |
| [x] | T-FX5 | Author `FX005-probe-matrix-trust.md` — pin F005 CLI override merge + rewrite prober scenarios + HTML matrix output + all-presets snapshot (top-10 #1/#3/#4/#7) | `docs/plans/018-agent-permissions/fixes/FX005-probe-matrix-trust.md` | Dossier exists |
| [x] | T-FX6 | Author `FX006-fs-guard-cross-platform.md` — platform-gated fs-guard regression suite + symlink-disabled fixture + residuals doc (top-10 #5) | `docs/plans/018-agent-permissions/fixes/FX006-fs-guard-cross-platform.md` | Dossier exists |
| [x] | T-FX7 | Author `FX007-permissions-docs-and-dogfood-adr.md` — coordination ↔ permissions cross-link + dogfood-rule ADR (top-10 #9/#10) | `docs/plans/018-agent-permissions/fixes/FX007-permissions-docs-and-dogfood-adr.md` | Dossier exists |
| [x] | T-FX8 | Author `FX008-coordination-write-precondition.md` — boot E186 + 5-signal denial + `--allow-coord-write-deny` opt-out + canonical companion frontmatter `write: allow` (issue [#25](https://github.com/AI-Substrate/minih/issues/25)) | `docs/plans/018-agent-permissions/fixes/FX008-coordination-write-precondition.md` | Dossier exists with locked E186 message + Chainglass repro fixture cited |
| [x] | T-FX9 | Author `FX009-status-pid-probe.md` — `minih status` lifts `isProcessAliveDefault` to gate `verdict: 'active'` on pid liveness; read-only (issue [#24](https://github.com/AI-Substrate/minih/issues/24)) | `docs/plans/018-agent-permissions/fixes/FX009-status-pid-probe.md` | Dossier exists; sister to FX011 reconcile |
| [x] | T-FX10 | Author `FX010-restricted-output-auto-narrow.md` — `restricted` preset auto-injects `<runDir>/output/` into `allowedRoots` for coord-enabled runs (issue [#25](https://github.com/AI-Substrate/minih/issues/25) suggested fix #1) | `docs/plans/018-agent-permissions/fixes/FX010-restricted-output-auto-narrow.md` | Dossier exists; depends on FX008 landing |
| [x] | T-FX11 | Author `FX011-minih-reconcile.md` — opt-in idempotent healer rewrites stale `run.json.status: 'active'` to `'crashed'` for dead pids; lock-protected; sister to FX009 (issue [#24](https://github.com/AI-Substrate/minih/issues/24)) | `docs/plans/018-agent-permissions/fixes/FX011-minih-reconcile.md` | Dossier exists |
| [x] | T-FX12 | Author `FX012-provider-stream-aborted.md` — adapter-side synthetic `provider_stream_aborted` event when SDK promise settles without `streaming_complete`; schema verbatim from Chainglass agent (issue [#24](https://github.com/AI-Substrate/minih/issues/24)) | `docs/plans/018-agent-permissions/fixes/FX012-provider-stream-aborted.md` | Dossier exists with locked schema |

---

## Acceptance Criteria

(Cross-reference to spec §`Acceptance Criteria` numbered AC1-AC35. Plan-level meta-ACs:)

- [ ] All 35 spec ACs covered by at least one task
- [ ] Each release R1-R6 ships independently with `just fft` green at tag time
- [ ] No silent behaviour change between consecutive minor versions (per AC32)
- [ ] Companion-mode review fires on every commit during implementation; findings folded inline
- [ ] Plan-level Flight Plan kept current (Phases table + Flight Log entries per release)
- [ ] Domain docs (runner, adapter, cli) updated by R4 close; mcp by R6+S close
- [ ] Documentation: `docs/how/permissions.md` ships with R1; AGENTS_README + README updated by R4
- [ ] FX001-FX012 dossiers exist before R6 ships — FX001/FX002/FX003 explicitly required by spec OQs; FX004-FX007 added from top-10 follow-up triage (see § Tasks — Deferred Follow-Up Dossiers and validation record dated 2026-05-04 in each dossier); FX008-FX012 added from GitHub issue triage 2026-05-04 (issues [#24](https://github.com/AI-Substrate/minih/issues/24) + [#25](https://github.com/AI-Substrate/minih/issues/25)) — converged design with @jakkaj's Chainglass agent across 9 issue comments before dossiers cut

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| SDK shape names drift between 0.3.x → 0.4.x | Medium | High | T-R1.14 SDK shape regression test catches drift in CI |
| Companion preset migration needs broader override than `network: allow` | Medium | Medium | T-R4.1 includes a real review-request fixture; expand override if `gh`-via-shell fails |
| First-party agent migration leaves something un-migrated | Low | High (fft red) | T-R4.2 fft-gating regression test IS the gate |
| Default-flip at R6 surprises a user despite five-release runway | Low | High (trust loss) | Six-release rollout with `lockedDefault` sticky + `MINIH_PERMISSIONS_DEFAULT` env var; T-R6.5 captures explicit gate evidence |
| Windows path edge cases (drive letter casing, UNC paths, case-insensitive FS) | Medium | Medium | T-R1.5 cross-platform test fixtures with `process.platform` mocks |
| Symlink-based escape we didn't think to test | Low | High | Realpath-each-access design + test fixtures for known patterns; documented residual risk for adversarial threat models |
| TOCTOU race exploited | Very Low | Medium | Documented as residual risk in `docs/how/permissions.md`; recommend OS-level isolation for adversarial threat models |
| Manifest 0.1.0 → 0.2.0 bump breaks installed-pack tests | Medium | Low (just snapshot work) | T-R3.1 + T-R3.6 update baseline together |
| Doctor noise budget complaints in R2-R4 | Medium | Low | Warning is one-line per agent; budget is 12 lines max in current internal set; budget = 0 once T-R4.3 done |
| 6-release rollout stretches over many months; SDK or upstream changes mid-rollout | Medium | Medium | Each release is self-contained; can re-architect at any gate without unwinding prior steps |

---

**Plan Status**: DRAFT, ready for `/plan-4-v2-complete-the-plan` validation.

**Next steps**:
- `/plan-4-v2-complete-the-plan` to validate readiness gates
- Then `/plan-6-v2-implement-phase --plan "<this file>"` (Simple mode → straight to implementation; per-release boundaries managed via task IDs T-R1.* → T-R6.*)
- Or escalate to per-release dossiers via `/plan-5-v2-phase-tasks-and-brief --phase "Release N"` if inline table becomes unwieldy

---

## Validation Record (2026-05-04)

**Skills run**: `/plan-4-v2-complete-the-plan` (5 inline validators; 0 HIGH; 1 MEDIUM + 1 LOW fixed inline) → `/validate-v2` (4 parallel agents; 1 HIGH + 2 MEDIUM + 3 LOW fixed inline; forward-compat re-run for missing Outcome line per Step 4.5).

| Agent | Lenses Covered | Issues | Verdict |
|---|---|---|---|
| Coherence | System Behavior, Integration & Ripple, Domain Boundaries, Hidden Assumptions | 1 LOW fixed | ✅ |
| Risk | Hidden Assumptions, Edge Cases & Failures, Security & Privacy, Deployment & Ops | 0 | ✅ |
| Completeness | Technical Constraints, Edge Cases & Failures, Performance & Scale, Concept Documentation | 1 HIGH fixed (AC34 executable test added as T-R1.20a), 1 MEDIUM fixed (T-R4.3 11→12 off-by-one) | ⚠️ → ✅ |
| Forward-Compatibility | Forward-Compatibility, Hidden Assumptions, Integration & Ripple | 1 MEDIUM fixed (T-S2 inside-MCP exemption pinned), 2 LOW fixed (escalation triggers machine-readable; sidecar lossless-preservation pinned in T-R3.3) | ⚠️ → ✅ |

**Lens coverage**: 11/12 (Performance & Scale and Security & Privacy explicitly engaged via Completeness + Risk; only User Experience not directly mapped — acceptable since this is an authoring/runtime feature with no end-user UX surface).

**Plan-tree traversal**: artifact lives at `docs/plans/018-agent-permissions/`. No `phase-N/` subfolders (Simple mode). Next-phase resolution applied at the inline-task level instead — release ordinals R1-R6 are the natural next-step boundaries; each is independently shippable.

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|---|---|---|---|---|
| `/plan-6-v2-implement-phase` | Unambiguous "Done When", domain assignment, release boundary per task | shape mismatch | ✅ | `agent-permissions-plan.md:127-236` (per-release task tables); `:9-16` (escalation triggers machine-readable) |
| `/plan-7-v2-code-review` / Power-On-Mode `code-review-companion` | One-commit-per-task reviewability; T-R<n>.<m> lookup; new files in Domain Manifest | test boundary | ✅ | `:190-199` (regression-test gate T-R4.2); release boundaries explicit; full Domain Manifest covers ~45 files |
| `code-review-companion` (own dogfood) | T-R4.1 frontmatter migration spec complete; AC35 fixture implementable | contract drift | ✅ | `:194-195` T-R4.1 includes real review-request fixture + `network: allow + shell: allow` contingency per AC35 |
| Future authors writing `permissions:` frontmatter | AGENTS_README scheduling; stable preset list; example agents to copy | encapsulation lockout | ✅ | `:133-146` (preset registry T-R1.2); `:210` (T-R4.5 AGENTS_README); `:191` (12-agent migration as canonical examples) |
| `/plan-5-v2-phase-tasks-and-brief` (escalation path) | Coherent "Release N" dossier-able unit | shape mismatch | ✅ | `:11-16` (4 machine-readable escalation triggers) |
| Future SDK upgrade work | SDK shape names pinned loudly in regression test | contract drift | ✅ | `:163-164` (T-R1.14 SDK shape regression); `:140` (narrowed `copilot-types.ts` signature) |

**Outcome alignment**: The artifact advances *"Safety-by-default for agents; trust ladder for installed packs; credible answer to 'what can this agent do to my machine?'"* by staging explicit permissions, terminal denials, sticky installed-pack defaults, and a six-release default flip without silent behavior changes.

**Standalone?**: No — six downstream consumers named with concrete requirements; all green after fixes.

**Fixes applied (HIGH)**:
- AC34 executable regression: NEW task T-R1.20a (`test/runner/permissions/config-discovery-exemption.test.ts`) — config discovery + read-only preset must NOT fire `permission_denied` when SDK loads `AGENTS.md` from `~`.

**Fixes applied (MEDIUM)**:
- T-R4.3 task description corrected to "remaining 12 internal agents" (was "11", but listed 12 names — off-by-one would have allowed one un-migrated agent past T-R4.2).
- T-S2 enriched with explicit "inside-MCP allowlist exemption preserved" note — `inbox_*`, `state_*`, `wait_*` tools remain unchanged when `permission_status` is added.

**Fixes applied (LOW)**:
- T-R4.8 path column corrected — removed phantom `agent-pack-via-runner/` reference (no such domain folder; agent-pack lives inside runner per plan 017).
- Plan header "Escalation Triggers" added — 4 machine-readable conditions for when Simple-mode → per-release dossier escalation fires.
- T-R3.3 enriched with lossless-preservation invariant — sidecar `lockedDefault` never overwritten by R4-R6 binaries; only `agent install` upgrade or `agent permissions reset` (deferred FX001) may change it.

Overall: **VALIDATED WITH FIXES** — 1 HIGH + 2 MEDIUM + 3 LOW resolved inline. Plan is **READY** for `/plan-6-v2-implement-phase`. Per the Simple-mode escalation triggers, opening R1 implementation should immediately verify the 25-task ceiling holds (R1 currently 22 tasks → within budget).
