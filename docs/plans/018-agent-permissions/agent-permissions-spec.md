# Agent Permissions: Fine-Grained Policy with Sane Defaults

**Mode**: Simple

📚 This specification incorporates findings from `research-dossier.md` and authoritative design decisions from three workshops (`workshops/001-fs-guard-and-allowed-roots.md`, `workshops/002-permission-error-protocol.md`, `workshops/003-default-flip-migration.md`).

---

## Research Context

The Copilot SDK (`@github/copilot-sdk@0.3.0`) already exposes a complete permission engine (8 kinds, 5 decision shapes, allowlist/denylist filters, FS provider injection, pre/post tool hooks). Today minih hard-codes `onPermissionRequest: approveAll` at four call sites in `src/adapter/sdk-copilot.ts` — that's the entire problem surface. The work is not "build a permission engine"; the work is "surface the SDK's engine through a friendly schema, add filesystem-scope reasoning, and ship a migration plan that doesn't break the world."

Key research findings driving the spec:
- **No existing permission policy in minih's schema, CLI, or runner** — `parseFrontmatter()` recognises only six keys today.
- **Filesystem scope must be a separate concept from `workingDirectory`** — workshop 005 deliberately set `workingDirectory` to the run folder for SDK session isolation; we cannot reuse it.
- **Outside-inbox lane (plan 008+) is the perfect channel for "permission failed"** — typed, append-only, already rendered by CLI tools.
- **Permission denial is not currently a typed event** — needs a new `permission_denied` event in the AgentEvent union.
- **6 prior learnings** apply (frontmatter hand-roll convention, `coordination:` field as the pattern template, SDK 0.3.0 kind shape pin, run-folder-as-cwd workshop 005 decision, inbox typed-message contract, manifest schema discipline from plan 017).

---

## Summary

**WHAT**: Replace minih's hard-coded "approve everything" (yolo) permission posture with a fine-grained, opt-in, schema-driven permission policy. Authors declare a preset (or detailed overrides) in agent frontmatter. The harness compiles the policy into an SDK `PermissionHandler` plus a filesystem guard, scoped by default to the user's current git project. Permission denials are instant-fail with a structured signal sent to the outside-inbox lane.

**WHY**: Today, any agent — including third-party packs installed via `minih agent install` — runs with full machine privileges. A misbehaving or prompt-injected agent can `rm -rf ~`. The runner already isolates session *artifacts* into a run folder; the agent itself can read/write *anywhere* the user can. Surfacing the SDK's existing permission primitives gives us safety-by-default, a graduated trust ladder for installed packs, deterministic companion-mode behaviour, and a credible answer to the question "what can this agent do to my machine?"

The bar this work clears:
1. **Authors can pin policy** with one frontmatter line for the 90% case.
2. **Operators can audit** what any installed agent is allowed to do.
3. **Runs that breach policy fail fast and loudly** with a structured signal observable from outside the run.
4. **Migration to safer defaults is staged across six numbered releases** so no existing user is surprised.

---

## Goals

1. **One-line opt-in**: authors get safe defaults by writing `permissions: restricted` (or any other named preset) in frontmatter — no further configuration required.
2. **Six built-in presets** covering the common shapes: `yolo`, `trusted`, `restricted`, `read-only`, `network`, `build-only`.
3. **Object-form overrides** for the cases presets don't cover, with per-kind decisions and per-MCP-server allowlists.
4. **Filesystem scoping** via an `allowedRoots` mechanism that defaults to the user's git project, with explicit `extend` / `replace` composition across four sources (harness default, frontmatter, CLI flag, env var).
5. **Symlink and path-traversal containment** at run time (canonicalize roots once, realpath each access; reject paths whose realpath escapes any root).
6. **Permission denial is terminal**: SDK `kind: 'reject'` decision + adapter emits typed event + runner fires five-signal protocol (events.ndjson, run.json, exit code 126, inside-state, outside-inbox) + run aborts immediately.
7. **CLI surface for set/list/list-available/migrate**: authors discover what's possible (`agent permissions list-available`), inspect a given agent (`list <slug>`), modify it (`set <slug>`), and bulk-migrate from the implicit default (`migrate --all`).
8. **Doctor surfaces drift**: `minih doctor` warns when an agent has no explicit `permissions:` field; `--strict` makes it fail.
9. **Plan-017 packs are protected** via a `lockedDefault` field in the install sidecar — packs installed before the schema arrived keep yolo behaviour through every minih upgrade until the user explicitly migrates.
10. **Operator escape hatch via `MINIH_PERMISSIONS_DEFAULT` env var** — fleet-wide override for CI scenarios where agents already run inside a sandbox.
11. **Six-release migration** (R1 schema → R2 doctor warns → R3 sidecar capture → R4 internals migrated → R5 new-agent default flips → R6 universal default flips) with each step individually reversible.
12. **No silent behaviour change** between any consecutive minor versions for any specific agent.

---

## Non-Goals

1. **Building a sandboxing primitive**: we use the SDK's existing `onPermissionRequest`, `availableTools`/`excludedTools`, and (Phase 6 only) `createSessionFsHandler`. We do not implement OS-level isolation (containers, chroot, seccomp). Users who need adversarial-threat-model containment use those tools; we document this honestly.
2. **TOCTOU-safe filesystem checks in v1**: the v1 FS guard is best-effort against well-behaved-but-mistaken agents and simple injection. Closing the TOCTOU race requires `openat` semantics that Node.js does not expose. Documented as residual risk.
3. **Interactive `ask` decisions in v1**: the SDK supports `kind: 'ask'` for human-in-the-loop sessions. Minih runs are headless; v1 always answers `kind: 'reject'` for any `deny`. `ask` is a v2 capability that requires a UI.
4. **Sub-agent / nested invocation gating**: once a custom tool or MCP server is approved, the SDK does not gate that handler's internal calls. We document this and recommend `permissions: read-only` for tightest containment, but we do not wrap arbitrary handler internals.
5. **`approve-for-session` / `approve-for-location` decisions** in v1: these are powerful in interactive contexts but meaningless in headless runs. Future work.
6. **Per-call rate limiting / circuit breakers**: an agent that hammers tool calls (each rejected) just produces a noisy event log. We do not throttle. The first denial is terminal anyway, so the rate problem is bounded.
7. **Pack signing or checksum verification of permission recommendations**: plan 017 deferred pack signing. This work increases the value of signing, but does not deliver it.
8. **Auto-flipping the default to `restricted`** in the same release as the schema arrives. The flip is staged across six releases per workshop 003 — Release 1 of this plan is no-op, Release 6 is the actual flip.
9. **Removing `yolo` as a preset**: yolo remains explicitly available forever as the trusted-dev-loop default. The flip is "implicit yolo → implicit restricted," not "delete yolo."
10. **Permission policy for the inside MCP server's own coordination tools** (`inbox_*`, `state_*`, `wait_*`): these write to coordination files exempt from FS guard. They are part of the harness, not the agent's tool surface.

---

## Target Domains

| Domain | Status | Relationship | Role in This Feature |
|---|---|---|---|
| `runner` | existing | **modify** | Owns the policy compiler, preset registry, FS guard, denial → status:failed path, outside-inbox `permission-error` append. New `src/runner/permissions/` subdirectory. |
| `adapter` | existing | **modify** | Replaces 4× `approveAll` constant with policy-derived `PermissionHandler`. Emits new `AgentPermissionDeniedEvent`. Narrows `copilot-types.ts` `onPermissionRequest` signature. |
| `cli` | existing | **modify** | New `agent permissions` subcommand family (`list-available`, `list`, `set`, `clear`, `migrate`). New `--permissions`, `--allowed-roots`, `--allowed-roots-only`, `--strict-fs`, `--dry-run-permissions` flags on `run` and `resume`. New `--accept-recommended-permissions` on `agent install`. New doctor check. New first-run banner. |
| `mcp` | existing | **consume** | No code changes (defensive: do not extend the inside MCP tool set in v1). The inside MCP server's own file ops are exempt from FS guard — established by workshop 001 § Q13. |
| `agent-pack` | existing (plan 017) | **modify** | Manifest (`agent.json`) gains `permissions.recommended` + `permissions.fallback` fields. Sidecar (`.minih-source.json`) gains `lockedDefault` + `lockedDefaultRecordedAt` + `lockedDefaultReason` fields. `manifestVersion` bumps to `0.2.0`. Install flow gains interactive `[A/F/Y/C]` prompt and matching non-interactive flags. |

### New Domain Sketches

**No new domains.** Permissions sit cleanly inside `runner/`, the way coordination already does. Cross-domain edges stay as today (`cli → runner → adapter`); no new contracts cross domain boundaries that aren't already part of the existing topology.

The new subdirectory `src/runner/permissions/` is a *module within* the runner domain, not a new domain. It exposes one new public contract — `PermissionPolicy` (the user-facing schema) and `ResolvedPolicy` (the compiled internal form) — consumed by `adapter` (via the `permissionHandler?` field on `AgentRunOptions`) and authored by `cli` (via frontmatter writers and CLI-flag overrides).

---

## Complexity

**Score**: CS-4 (large)

**Breakdown**: S=2, I=1, D=1, N=1, F=2, T=2 → P=9 → CS-4

| Dim | Value | Reason |
|---|---|---|
| Surface Area (S) | 2 | Cross-cutting: 7 source files modified + 5 new files in `runner/permissions/` + 2 new schemas + manifest schema bump + every internal agent's prompt.md updated + AGENTS_README + new `docs/how/permissions.md` |
| Integration (I) | 1 | One external dep (Copilot SDK, already pinned); no new third-party packages |
| Data/State (D) | 1 | New schemas (`permission-policy.json`, `permission-error.json`); manifest 0.1.0 → 0.2.0 with backward-compat read; one-time idempotent sidecar backfill at R3 |
| Novelty (N) | 1 | Schema design + CLI UX have multiple valid shapes; mitigated by three workshops resolving the design questions explicitly |
| Non-Functional (F) | 2 | Security feature — bugs have direct user-trust impact; behaviour change must be observable for every existing agent across six releases; performance must be near-zero on the hot path |
| Testing/Rollout (T) | 2 | Six-release rollout, each with its own gate; per-release behaviour change must not regress prior releases; flag-gated paths require integration tests; cross-platform (POSIX + Windows) FS guard requires platform-specific fixtures |

**Confidence**: 0.75 — the SDK surface is well-understood, the workshops have resolved the design ambiguity, and the rollout shape is clear. Residual uncertainty: Windows symlink behaviour (we'll know more after writing fixtures), exact heuristic tuning for `migrate` recommendations (will iterate after first real use).

**Assumptions**:
- `@github/copilot-sdk` permission API is stable through 0.3.x → 0.4.x (decision-kind names, request-kind enum, handler signature). We pin shape names in our policy types; one regression test exercises every name to catch SDK drift early.
- Plan 017 (agent-pack install) is merged to `main` before R3 ships. PR #23 is open and CI-green at spec time.
- Plan 008+ (outside inbox lane, typed messages) is in production (it is — code paths exist and are tested).
- Workshop 005's decision (workingDirectory = run folder) holds. We do not re-litigate it.
- POSIX `path.realpath` semantics are sufficient for v1 FS guard. Windows is supported but has caveats documented honestly.
- "Current git project" can be resolved deterministically from the user's invocation cwd (or fallback to invocation cwd when no `.git` exists).

**Dependencies**:
- Plan 017 merged to main (FX003a/FX003b cleanup pending; not blocking for this spec, but the manifest schema bump in this work overlaps with FX003b).
- `code-review-companion` agent's `agent.json` becomes the canonical example for `permissions.recommended`. Updating it is part of Phase 5.
- No external service or third-party library blockers.

**Risks**:
- **Default flip is irreversible without a separate revert release**: once R6 ships, undoing it requires R7. Mitigation: 4-week dwell at R5; explicit "all gates green" judgment call documented in R6 release notes.
- **First-party agent migration creates a flag-day**: if R4 ships incomplete, doctor regression test fails on a fresh checkout. Mitigation: regression test gates R4; CI fft enforces it.
- **Windows path edge cases**: case-insensitive FS, drive letter casing, UNC paths, mixed separators. Mitigation: `canonicalize()` test fixtures cover each; `process.platform` mocks for Windows-only paths.
- **Symlink-based escapes more clever than what we test**: e.g. ELOOP cycles, broken-target symlinks, symlinks created mid-run. Mitigation: realpath each access; reject on any error; test fixtures cover the stated cases.
- **Companion mode regressions during migration**: the companion (this feature's own dogfood reviewer) will be one of the first agents migrated. If the migration breaks the companion, future implementation phases lose their reviewer. Mitigation: the companion is touched in Phase 5 with a dedicated regression test; the manifest 0.2.0 bump bumps the schema test snapshot deliberately.
- **Doctor noise budget**: 12 first-party agents × 1 warning/run × N CI invocations could feel spammy in R2. Mitigation: warning is one-line per agent; doctor JSON output unchanged; no severity escalation until R6.
- **TOCTOU race exploitation in adversarial scenarios**: documented residual risk; we recommend OS-level isolation for adversarial threat models. Mitigation: clear documentation in `docs/how/permissions.md` § Threat Model.

**Phases** (high-level — `/plan-3` will refine):
- **Phase 1 — Schema & policy compiler** (runner-only, additive, zero behaviour change): types, presets, frontmatter parser, AgentDefinition extension. Ships R1.
- **Phase 2 — Handler + adapter wiring**: PermissionHandler factory, FS guard, layer-(a) shell-arg inspection, AgentRunOptions extension. Replaces `approveAll` for opted-in agents only. Behaviour change: agents with `permissions:` frontmatter get policy enforcement; agents without it stay yolo.
- **Phase 3 — Failure path & outside-inbox signal**: `AgentPermissionDeniedEvent`, runner short-circuit, five-signal emission with mandatory/best-effort split, schema for `permission-error` message, exit code 126.
- **Phase 4 — CLI surface**: `agent permissions` subcommands, `run`/`resume` flags, doctor check, first-run banner, `MINIH_PERMISSIONS_DEFAULT` env var. Ships R2.
- **Phase 5 — Agent-pack integration & internal-agent migration**: `agent.json` manifest 0.2.0 with `permissions.recommended` + `permissions.fallback`; sidecar 0.2.0 with `lockedDefault`; one-time backfill; install banner with `[A/F/Y/C]` choice; migrate every first-party agent under `agents/`. Domain doc updates. Ships R3 + R4.
- **Phase 6 — Strict FS mode** (optional / stretch): `createSessionFsHandler` provider, `--strict-fs` flag, benchmark. Ships independently of the rollout.
- **Phase 7 — Default flip** (R5 then R6): scaffold default flip in `minih init`; `minihReleaseDefault` constant flips; doctor severity ramps; sunset dwell.

---

## Acceptance Criteria

### AC1: Frontmatter schema accepted and parsed
Given an agent with `permissions: restricted` in `prompt.md` frontmatter, when `minih run <slug>` is invoked, then the runner resolves a `ResolvedPolicy` with preset `restricted` and the resolved policy is recorded in `<runDir>/run.json` under `permissions.preset = 'restricted'`.

### AC2: Object-form schema parses overrides correctly
Given an agent with `permissions: { preset: restricted, overrides: { mcp: { allowedServers: ['minih-coordination'] } } }`, the resolved policy's `mcpAllowedServers` field equals `['minih-coordination']` and all other kind decisions match the `restricted` preset.

### AC3: Six presets compile to expected decision matrices
For each of the six presets (`yolo`, `trusted`, `restricted`, `read-only`, `network`, `build-only`), the resolved policy's `decisions` map matches the canonical table from workshop 001's preset registry. A baseline snapshot test prevents accidental loosening.

### AC4: `allowedRoots` defaults to the git project
Given a user invokes `minih run <slug>` from `/Users/jk/work/repo/src/`, where `/Users/jk/work/repo/.git/` exists, then `ResolvedPolicy.canonicalRoots` equals `[/Users/jk/work/repo]` (or its realpath if the path contains symlinks) and `rootsResolvedFrom["/Users/jk/work/repo"] === "git-root-of-cwd"`.

### AC5: `allowedRoots` falls back to cwd when no git root
Given a user invokes `minih run <slug>` from `/tmp` (no `.git`), then `canonicalRoots = [/tmp]` and `rootsResolvedFrom["/tmp"] === "cwd-no-git-root"`. Doctor emits a warning when default resolution lands on `$HOME` or `/`; minih refuses to start when the default lands on `/` and any preset other than `yolo` is in effect.

### AC6: Multi-source root composition (extend mode)
Given harness default = `[/repo]`, frontmatter = `{ allowedRoots: { mode: extend, roots: ['/tmp/cache'] } }`, env var `MINIH_ALLOWED_ROOTS=/srv/data`, CLI flag `--allowed-roots /tmp/extra`, then the final canonical roots are the deduplicated union of all four sources: `[/repo, /tmp/cache, /srv/data, /tmp/extra]` (each canonicalized via realpath).

### AC7: Multi-source root composition (replace mode)
Given a frontmatter `allowedRoots.mode = replace`, the harness default is wiped from contribution; only frontmatter + env var + CLI roots compose. `--allowed-roots-only` on CLI further wipes everything below it.

### AC8: Symlink escape from inside a root is denied
Given root `/repo` (canonical), and `/repo/secret-link` is a symlink to `/etc/passwd`, when an agent attempts `read /repo/secret-link`, then the FS guard's realpath resolves to `/etc/passwd`, the prefix check fails, the SDK receives `kind: 'reject'`, and the run terminates with exit code 126.

### AC9: Forbidden roots refused at start
Given `--allowed-roots /` or `--allowed-roots /etc`, then `minih run` exits before the agent starts with a clear error message naming the forbidden path. The denylist also includes `/sys`, `/proc`, `/dev`, and `os.homedir()` (the user's bare home dir).

### AC10: Permission denial is terminal
Given an agent with `permissions: read-only`, when the agent attempts a `shell` tool call, then within 1 second of the SDK's permission request: (a) the handler returns `kind: 'reject'`, (b) the adapter emits a `permission_denied` event, (c) the runner appends one line to `events.ndjson`, (d) `run.json` records `status: 'failed'`, `exitCode: 126`, `terminalReason: 'permission-denied'`, and (e) the SDK session is aborted (no further tool calls).

### AC11: Permission denial signals to outside inbox (coordinated)
Given a coordinated agent (per workshop 005 frontmatter `coordination: enabled`), the same denial scenario as AC10 ALSO produces (f) one new line in `<runDir>/inbox/outside/messages.ndjson` matching the `permission-error` schema with `meta.contractVersion: 1`, `meta.kind: 'shell'`, `meta.reasonCode: 'kind-denied'`, `meta.exitCode: 126`, and the resolved policy preset name.

### AC12: Permission denial is best-effort for coordination signals
Given a denial during which `<runDir>/inbox/outside/messages.ndjson` cannot be written (simulated via permission flip), the run STILL terminates with exit code 126 and `run.json` STILL records `status: 'failed'`. The failure is reflected in `run.json.coordinationSignals.outsideInboxAppend = "failed: <reason>"`. A warning prints to stderr; the process does not throw.

### AC13: First-trigger-wins between racing terminal causes
Given a permission denial at t=58s and a timeout at t=60s on a 60-second run, the final state is `terminalReason: 'permission-denied'`, `exitCode: 126`. The timeout is recorded in `events.ndjson` but is a no-op for terminal signals (idempotent guard).

### AC14: Idempotent on `(runId, requestId)` denial
Given the SDK delivers the same `permission_denied` event twice (e.g. via internal retry), the runner emits exactly one line to `events.ndjson`, makes exactly one `run.json` write, and appends exactly one outside-inbox entry.

### AC15: CLI list-available shows all presets and kinds
`minih agent permissions list-available` prints a table of all six presets with their kind-decision matrices and human-readable descriptions; `--json` produces a machine-readable equivalent.

### AC16: CLI list shows resolved policy
`minih agent permissions list <slug>` shows the agent's frontmatter policy (raw); `--effective` additionally shows the resolved policy after harness defaults, env-var, and CLI flag overrides are applied.

### AC17: CLI set updates frontmatter idempotently
`minih agent permissions set <slug> read-only` writes `permissions: read-only` to `<agentsDir>/<slug>/prompt.md`. Re-running the same command produces no diff. Re-running with a different preset produces exactly one frontmatter line change.

### AC18: CLI migrate dry-run shows diff and recommendation
`minih agent permissions migrate <slug> --dry-run` prints the proposed unified diff plus the recommended preset (per heuristic table from workshop 003) and rationale, without modifying any files.

### AC19: CLI migrate --all bulk-migrates with --yes
`minih agent permissions migrate --all --yes` iterates every agent without explicit `permissions:`, applies the heuristic recommendation, and writes the change. Each agent's diff prints to stdout in the audit log. Exit code 0 on success, non-zero on any single failure.

### AC20: Doctor warns on missing permissions field (R2+)
After R2 ships, `minih doctor` produces exactly one `warning` severity per agent without explicit `permissions:`. The warning message contains the migration command. `doctor --strict` exits non-zero.

### AC21: Doctor passes for explicit permissions: yolo
`permissions: yolo` (explicit) produces a `pass` severity in doctor; `permissions:` absent produces `warning`. The two cases are distinguishable.

### AC22: lockedDefault sidecar is written at install time (R3+)
`minih agent install <slug>` writes `lockedDefault`, `lockedDefaultRecordedAt`, and `lockedDefaultReason` to `<agentsDir>/<slug>/.minih-source.json`. The reason is one of: `accepted-recommendation`, `declined-recommendation`, `no-recommended-preset-at-install-time`, `local-install-no-manifest`, `pre-schema-install-grandfathered`.

### AC23: lockedDefault one-time backfill
The first `minih run` after upgrading to R3 detects sidecars missing `lockedDefault` and writes `lockedDefault: 'yolo'`, `lockedDefaultReason: 'pre-schema-install-grandfathered'`. Idempotent: repeated reads do not re-write the timestamp.

### AC24: Resolution order
For an agent without explicit `permissions:`, the run-time policy resolves in this exact order: (1) frontmatter explicit, (2) sidecar `lockedDefault`, (3) `MINIH_PERMISSIONS_DEFAULT` env var, (4) `minihReleaseDefault`. A test fixture exercises all four positions independently.

### AC25: MINIH_PERMISSIONS_DEFAULT env var overrides implicit default
With `MINIH_PERMISSIONS_DEFAULT=yolo` set and no frontmatter `permissions:`, an agent runs with full permissions even when `minihReleaseDefault` would otherwise be `restricted`. A yellow stderr banner prints on every `minih run` invocation when the env var is non-empty.

### AC26: Manifest 0.2.0 with permissions.recommended is honoured
Installing a pack whose `agent.json` has `permissions.recommended: 'read-only'` produces an interactive `[A/F/Y/C]` prompt when run interactively, or the corresponding behaviour for `--yes` (auto-accept), `--yes --no-recommended` (use fallback), `--yes --permissions yolo` (explicit override). The chosen preset is written to `lockedDefault`.

### AC27: First-run banner detects version change
The first `minih run` after a version bump (detected via `~/.minih/last-seen-version`) prints a one-time banner pointing at `docs/how/permissions.md` and the migration command. `MINIH_NO_FIRST_RUN_BANNER=1` or `~/.minih/permissions-acknowledged` suppresses it.

### AC28: All first-party agents have explicit permissions (R4+)
A regression test (`test/agents/permissions-explicit.test.ts`, gated to fft) asserts every `agents/*/prompt.md` (excluding `_shared/`) carries an explicit `permissions:` field. New first-party agents fail CI without it.

### AC29: New agents from `minih init` default to restricted (R5+)
`minih init <slug>` writes `permissions: restricted` into the scaffolded `prompt.md` frontmatter starting at R5.

### AC30: Default flips for unmigrated agents at R6
At R6, an agent with no explicit `permissions:` AND no sidecar `lockedDefault: yolo` AND no env-var override resolves to `restricted` instead of `yolo`. Existing agents with `lockedDefault` (set in R3+) are unaffected.

### AC31: Resume after permission denial re-resolves policy
Given a run terminated by permission denial, `minih resume <slug> --run <runId>` re-loads the agent definition, recompiles the policy from current frontmatter + flags, and starts a fresh run. The `run.json.resumes[]` entry records `previousTerminalReason: 'permission-denied'`. The previously-denied tool call is NOT auto-retried.

### AC32: No silent behaviour change between consecutive minor versions
For each pair of consecutive minor versions across R1-R6, a regression test fixture demonstrates that an agent with stable frontmatter behaves identically (same kind decisions, same exit code on identical fixture inputs). A behaviour change requires an explicit author opt-in (frontmatter edit) or operator opt-in (env var or migration command).

---

## Risks & Assumptions

(Surfaced in the Complexity § Risks block above. Restated here at spec scope:)

1. **The SDK permission shape names may drift between minor versions.** Mitigation: pin shape names in our policy types as string literal unions; one integration test exercises every decision-kind name via the SDK to catch drift.
2. **First-party agent migration in R4 is a flag-day**: an incomplete migration breaks fft. Mitigation: the regression test in Phase 5 IS the gate.
3. **Windows path edge cases** are easier to test wrong than right. Mitigation: dedicated `canonicalize()` test suite with `process.platform` mocks; OS-conditional CI runner if available.
4. **`MINIH_PERMISSIONS_DEFAULT` may be set in long-lived shells** and forgotten. Mitigation: stderr banner on every `minih run` when the env var is non-empty.
5. **Companion-mode regression risk**: the companion (this work's own reviewer) is among the first agents migrated. Mitigation: dedicated regression test for the companion's expected behaviour after migration.
6. **TOCTOU race remains exploitable**: documented residual risk. We do not promise containment against active local attackers.
7. **Schema future-compat**: `meta.contractVersion: 1` reserves room for additive fields; future workshops handle removals via major bumps.

**Assumptions** (restated):
- SDK 0.3.x permission API is stable through the rollout window (1.5+ years).
- Plan 017 ships to main during R1/R2.
- Workshop 005's `workingDirectory = run folder` decision holds.
- `path.realpath` semantics are sufficient for v1.
- Six-release rollout windows are at least 4 weeks each (≥ 24 weeks total).

---

## Open Questions

All eight original OQs were resolved in `/plan-2-clarify` Session 2026-05-04. See `## Clarifications` below for the resolution record. Net effect on spec:

- **OQ1 (companion preset)** → RESOLVED: `read-only` + override `network: allow`. Phase 5 will write this exact frontmatter to `agents/code-review-companion/prompt.md`.
- **OQ2 (config discovery)** → RESOLVED: exempt config discovery from FS guard; document in `docs/how/permissions.md`.
- **OQ3 (`permission_status` MCP tool)** → RESOLVED: include in scope as **Phase 6** (alongside `--strict-fs`). New AC added.
- **OQ4 (reset command)** → RESOLVED: defer to follow-up dossier `FX001-permissions-reset.md`.
- **OQ5 (auto-commit on bulk migrate)** → RESOLVED: do not auto-commit; user runs `git diff` and commits.
- **OQ6 (`permissions check` dry-run)** → RESOLVED: defer to follow-up dossier `FX002-permissions-check.md`.
- **OQ7 (doctor escalation at R6)** → RESOLVED: do NOT escalate; warning stays warning; defer hardening to follow-up `FX003-doctor-severity.md`.
- **OQ8 (SDK minVersion)** → RESOLVED: keep `>=0.3.0`; pin shape names in policy types; one regression test exercises every decision-kind name.

No remaining open questions. Spec is **Clarified**, ready for `/plan-3-v2-architect`.

---

## Workshop Opportunities

Three workshops are **already authored and form authoritative design decisions** for this spec:

| Topic | Type | Workshop | Status |
|---|---|---|---|
| FS-Guard semantics & `allowedRoots` resolution | Integration Pattern + Storage Design | `workshops/001-fs-guard-and-allowed-roots.md` | ✅ Drafted |
| Permission-error multi-channel signal contract | State Machine + Integration Pattern | `workshops/002-permission-error-protocol.md` | ✅ Drafted |
| Default-flip migration strategy | Integration Pattern + State Machine + CLI Flow | `workshops/003-default-flip-migration.md` | ✅ Drafted |

These three resolve the three highest-leverage design questions (FS scope semantics, error-protocol atomicity, multi-release rollout). All three transition Draft → Approved at the close of `/plan-2-clarify`.

### Additional workshop candidates (NOT required for this plan)

| Topic | Type | Why Workshop | Key Questions |
|---|---|---|---|
| Strict-FS provider design (Phase 6) | Integration Pattern | `createSessionFsHandler` provider semantics; symlink/TOCTOU honest discussion; perf impact | How do we expose openat-like semantics through the provider? What's the perf budget vs Layer-(a)? When does it become default? |
| Heuristic engine for `migrate --all` recommendations | Other / Algorithm | Today the heuristic is a small if-elif table. Adding more signals (file globs touched, prior-run telemetry) might make it smarter | What's the minimum quality bar before a recommendation is "trustworthy"? How do users override at scale? |
| Companion-mode special preset | Other / Preset Design | Companions are read-mostly but need narrow allowlists (gh CLI, lint runners). May warrant a dedicated preset | Should `companion` be a 7th preset? Or is `read-only + overrides` enough? |

These are NOT scoped into plan 018. They become candidates for separate plan ordinals if they materialize as work.

---

## Out-of-Spec Notes

- **Worktrees, submodules**: workshop 001 § Q2 resolved both. The git-root walker handles each correctly.
- **MCP server scoping**: workshop 001 § Q8 resolved. `mcp.allowedServers: string[]` in policy overrides controls which servers run; we do not try to FS-scope a remote MCP server (it does what it does).
- **Custom-tool internals**: workshop 001 § Q8 + workshop 002 § Q5 resolved. The `permissions.custom-tool` policy gates *whether the tool runs*, not what it does inside. Documented honestly.
- **Resume-takeover behavior**: workshop 002 § Q8 resolved. Permissions re-resolve fresh on resume; previous denial preserved in audit trail; previously-denied tool call is NOT auto-retried.
- **Schema versioning**: `permission-error.json` carries `meta.contractVersion: 1`; manifest bumps to 0.2.0; sidecar bumps to 0.2.0. Plan-017's existing schema discipline applies.

---

**Spec Status**: Clarified, ready for `/plan-3-v2-architect`.

**Generated**: 2026-05-04T11:35Z (clarified 11:43Z)

**Next step**: Run `/plan-3-v2-architect` to produce the phase-by-phase implementation plan.

---

## Clarifications

### Session 2026-05-04

**Q1 — Workflow Mode**: User chose **Simple Mode** (single-phase, inline tasks).

> Note: this overrides the natural fit suggested by CS-4 (which would default to Full). The implication is that the 7 preliminary phases collapse into a single inline task table organised by release ordinal (R1 schema → R2 doctor → R3 sidecar → R4 internal-migration → R5 new-default → R6 universal-flip), with Phase 6 (strict-fs + `permission_status` MCP tool) carried as a clearly-marked optional/stretch block. The spec's `## Complexity § Phases` block is preserved as a logical grouping, but `/plan-3-v2-architect` will produce one tasks table rather than per-phase dossiers.

**Q2 — Testing Strategy**: User chose **Hybrid**.

- **TDD for**: policy compiler (`src/runner/permissions/policy.ts`), FS guard (`fs-guard.ts`), PermissionHandler factory (`handler.ts`), preset registry round-trip (`presets.ts`), denial → status:failed runner short-circuit.
- **Lightweight for**: CLI subcommand wiring (`agent permissions` family), doctor warning rendering, first-run banner, manifest 0.2.0 install banner.
- **Manual verification for**: full six-release rollout fixture chain (R1 → R6 time-travel regression).
- Mock policy: **B (targeted)**. Real symlink trees in `tmpdir()` for FS guard. Mock SDK PermissionHandler at the adapter boundary (mirrors existing `FakeAgentAdapter` pattern). No SDK process spin-up in unit tests.

**Q3 — Mock Usage**: User chose **B (targeted)**. See Q2.

**Q4 — Documentation Strategy**: User chose **C (Hybrid)**.

- `docs/how/permissions.md` — full reference (~600+ LOC): preset matrix, threat model with TOCTOU honesty, FS-guard semantics, migration playbook (six releases), error reference (E2xx codes), cross-platform path notes.
- `AGENTS_README.md` — new "Permissions" section in the same place model/timeout/coordination are documented; bundled to `dist/AGENTS_README.md` via existing `scripts/copy-schemas.js` pipeline.
- `README.md` — one-paragraph "Agent permissions" subsection under Features; links to `docs/how/permissions.md`.

**Q5 — Companion preset (OQ1)**: User chose **A** — `code-review-companion` migrates to `read-only` preset with explicit `network: allow` override. Resolves OQ1.

```yaml
permissions:
  preset: read-only
  overrides:
    network: allow    # for gh CLI during reviews
```

**Q6 — Optional v1 features (OQ3 + OQ4 + OQ6 + OQ7)**: User chose **B** — include `permission_status` MCP tool in **Phase 6** alongside `--strict-fs`. Defer reset command (OQ4), check command (OQ6), and doctor-severity escalation (OQ7) to follow-up fix dossiers (`FX001`, `FX002`, `FX003`).

The `permission_status` MCP tool exposes the resolved policy to the inside agent so it can self-check what's allowed before attempting a tool call. New AC added below.

**Q7 — Config discovery (OQ2)**: User chose **A** — exempt SDK config discovery from FS guard. The SDK walks up from cwd for `.copilot/`, `.mcp.json`, `AGENTS.md` as part of its own infrastructure; this is not a user-data access path. Documented in `docs/how/permissions.md`. Resolves OQ2.

**Q8 — Harness readiness**: User chose **A** — no formal harness needed. The existing `just fft` pipeline (`lint → format → build → typecheck → test → audit`) plus companion-mode review (Power-On-Mode) cover the Boot/Interact/Observe feedback-loop role for this feature. The companion is itself touched by this work (Phase 5 migrates its frontmatter) and acts as the live reviewer during implementation.

---

## Updates to Spec from Clarifications

### Mode (header)
Set to **Simple** per Q1.

### Testing Strategy
**Approach**: Hybrid (TDD for security-critical core; Lightweight for CLI wiring; Manual for cross-release time-travel).
**Rationale**: bugs in policy compilation, FS guard, or handler factory directly become trust failures — every behavioural branch needs a test. CLI wiring is plumbing and easy to eyeball. The full six-release rollout is hard to automate end-to-end and benefits more from manual fixture-chain verification at each gate.
**Focus Areas**: policy compiler (every preset × every kind), FS guard (escape patterns × platforms), handler factory (every decision shape), runner short-circuit (idempotency + first-trigger-wins).
**Excluded**: live SDK process tests (mocked at boundary); benchmarking strict-fs in v1 (defer to Phase 6).
**Mock Policy**: targeted — real symlink fixtures for FS guard; mocked SDK at adapter boundary.

### Documentation Strategy
**Approach**: Hybrid (README quick-start + AGENTS_README authoring guide + docs/how/ deep reference).
**Rationale**: this touches every author (so README needs visibility) AND requires depth (threat model, migration story).
**Locations**:
- `README.md` § Permissions — one paragraph, links out
- `AGENTS_README.md` § Permissions — frontmatter authoring guide; bundled to dist
- `docs/how/permissions.md` — full reference (~600 LOC)

### Phase 6 scope expansion (Q6 outcome)
Phase 6 now covers TWO deliverables (instead of one):
- (Original) `createSessionFsHandler` provider + `--strict-fs` flag + benchmark
- (New) `permission_status` MCP tool registered on the inside MCP server, returns resolved policy snapshot to the inside agent

### Phase 5 deliverable refinement (Q5 outcome)
The companion's frontmatter migration is pinned to `read-only + network: allow` (not bare `read-only`).

### Acceptance Criteria additions

**AC33** (from OQ3 → Phase 6): Inside MCP server exposes a `permission_status` tool that returns the resolved policy as JSON `{preset, decisions, canonicalRoots, mcpAllowedServers, customToolAllowedNames}`. Coordinated agents can call it without triggering a permission request (the tool is in the always-allowed inside-MCP allowlist). Restricted agents use the result to plan tool sequences without trial-and-error denials.

**AC34** (from OQ2): SDK config discovery (when `enableConfigDiscovery: true`) is NOT subject to FS guard. The SDK's own walks up from cwd to find `.copilot/`, `.mcp.json`, `AGENTS.md` proceed unaffected. A test asserts that an agent with `permissions: read-only + allowedRoots: [/repo]` can still load `AGENTS.md` from `~` without a denial event.

**AC35** (from Q5 — companion preset): The migrated `code-review-companion` agent runs successfully against a Phase-5 fixture review-request flow, calls `gh` CLI for context retrieval (network), and does NOT trigger any `permission_denied` event. Regression test asserts `policy.preset === 'read-only'`, `policy.decisions.network === 'allow'`, `policy.decisions.shell === 'allow'` (because gh runs through shell), and that the test fixture's `gh` call returns successfully.

> Note re AC35: `read-only` preset normally denies shell. For the companion case, the override needs to permit `shell` *AND* `network`, because `gh` is invoked through the SDK's shell tool. Phase 5 implementation must verify the override expressivity — if a single `network: allow` override is insufficient, escalate (e.g. add `shell: allow` too, or document the override pair).

### Risks adjustments

Add risk:
- **Companion preset migration may need broader override than expected**: AC35's note above. If `network: allow` alone doesn't unblock `gh` (because `gh` is a shell tool), the override expands to `network: allow + shell: allow`. That's a meaningful preset breach — needs verification at Phase 5 fixture stage. Mitigation: build the regression fixture FIRST in Phase 5; only declare the migration successful when the companion completes a real review request unmodified.

### Deferred Follow-Ups (FX dossiers under `fixes/`)

To be authored by `/plan-3-v2-architect` as `docs/plans/018-agent-permissions/fixes/`:

- **FX001 — `minih agent permissions reset <slug>`**: clear sidecar `lockedDefault` so the agent picks up `minihReleaseDefault`. Defer post-R6.
- **FX002 — `minih agent permissions check <slug>`**: dry-run mode that records all tool-call attempts and reports whether any would have been denied under the declared preset. Defer post-R6.
- **FX003 — Doctor severity escalation at R6+N**: graduate "missing permissions field" warning to fail at some future release. Decision deferred to that release's planning.
