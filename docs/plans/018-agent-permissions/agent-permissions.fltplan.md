# Flight Plan: Agent Permissions

**Plan**: 018-agent-permissions
**Spec**: [agent-permissions-spec.md](agent-permissions-spec.md)
**Status**: ✅ Validated — ready for `/plan-6-v2-implement-phase`
**Mode**: Simple
**Created**: 2026-05-04
**Clarified**: 2026-05-04

> Plan-level Flight Plan — executive overview. Enriched as `/plan-3-v2-architect` produces the phased plan.

---

## Mission

Replace minih's hard-coded "approve everything" permission posture with a fine-grained, opt-in, schema-driven policy system. Surface the Copilot SDK's existing permission engine (8 kinds, 5 decision shapes, allowlist/denylist filters, FS provider) through a friendly preset-based frontmatter schema. Default agent filesystem scope to the user's git project. Make permission denials terminal with a structured outside-inbox signal. Migrate the default from `yolo` to `restricted` across six numbered releases without surprising any existing user.

## Phases (preliminary — refined by /plan-3)

| # | Title | Status | Ships in | Tasks |
|---|---|---|---|---|
| R1 | Schema arrives (no behaviour change) | ⏳ Pending | R1 | T-R1.1 → T-R1.22 + T-R1.20a (23 tasks) |
| R2 | Doctor warns; CLI tooling lands; prober pack ships | ⏳ Pending | R2 | T-R2.1 → T-R2.13 (13 tasks; +2 prober) |
| R3 | Pack install captures intent; prober matrix grows | ⏳ Pending | R3 | T-R3.1 → T-R3.9 (9 tasks; +1 prober) |
| R4 | Internal agents migrated; full 10-scenario matrix | ⏳ Pending | R4 | T-R4.1 → T-R4.10 (10 tasks; +1 prober) |
| R5 | Default flips for new agents | ⏳ Pending | R5 | T-R5.1 → T-R5.3 (3 tasks) |
| R6 | Universal default flip + final probe gate | ⏳ Pending | R6 (gated) | T-R6.1 → T-R6.6 (6 tasks; +1 prober gate) |
| 6S | Stretch: strict-fs + permission_status MCP | ⏳ Optional | Independent | T-S1 → T-S4 (4 tasks) |
| FX | Deferred follow-up dossiers | ⏳ Pending | Pre-R6 | T-FX1 → T-FX4 (4 tasks; +FX004 prober outside-readback) |

**Total: ~73 tasks (was 65; +8 prober/validation tasks per workshop 004) across 6 numbered releases + stretch + 4 FX dossiers.**

[Full plan: `agent-permissions-plan.md`]

## Key Decisions Locked by Workshops

- **`allowedRoots` is separate from SDK `workingDirectory`** — workshop 005 reserves the latter for session isolation; we add a new resolved-root concept defaulting to `gitRootOf(invocationCwd) ?? invocationCwd`.
- **Symlinks**: canonicalize roots once at registration; realpath each access. Reject anything whose realpath escapes any root.
- **Multi-source root composition**: explicit `extend` / `replace` modes; four sources merge in fixed order (harness → frontmatter → env → CLI).
- **Permission denial is always terminal**: SDK reject → adapter emits typed event → runner fires five-signal protocol → exit code 126.
- **Mandatory vs best-effort signals**: events.ndjson + run.json + exit code are mandatory; outside-inbox + inside-state are best-effort with reason recording.
- **First-trigger wins** when multiple terminal causes race (timeout vs denial vs crash). Idempotent on `(runId, requestId)`.
- **Six-release rollout** with each step individually reversible. Distinguishability via explicit `permissions: yolo` vs implicit absent. Sticky `lockedDefault` sidecar for plan-017 packs.
- **`MINIH_PERMISSIONS_DEFAULT` env var** is the only fleet-wide escape hatch in v1.

## Acceptance Criteria Summary

32 ACs across schema (1-9), runtime (10-14), CLI (15-19), doctor (20-21), pack integration (22-23), resolution (24-26), banners (27), migration (28-30), and behaviour-stability (31-32). See spec.

## Risks & Open Questions

- 8 OQs to resolve in `/plan-2-clarify` (preset for code-review-companion, config-discovery exemption, optional `permission_status` MCP tool, reset command, auto-commit on bulk migrate, retroactive doctor escalation, MCP `permission_status` tool, minimum SDK version).
- Top risks: SDK shape drift between minor versions, Windows path edge cases, first-party-migration flag-day at R4, TOCTOU residual risk (documented honestly, not closed in v1).

## Cross-Plan Touchpoints

- **Plan 008+ outside inbox**: reused as the `permission-error` channel. New typed message contract (`meta.contractVersion: 1`).
- **Plan 017 agent packs**: manifest 0.1.0 → 0.2.0 with `permissions.recommended` + `permissions.fallback`; sidecar gains `lockedDefault` + reason fields. FX003b cleanup overlaps; resolve order discussed in spec.
- **Plan 005 workingDirectory decision**: respected; not re-litigated.
- **Plan 016 companion mode**: `code-review-companion` is migrated in Phase 5; companion-manifest snapshot test re-baselined.

## Workshop Index

- ✅ [`workshops/001-fs-guard-and-allowed-roots.md`](workshops/001-fs-guard-and-allowed-roots.md) — Integration Pattern + Storage Design
- ✅ [`workshops/002-permission-error-protocol.md`](workshops/002-permission-error-protocol.md) — State Machine + Integration Pattern
- ✅ [`workshops/003-default-flip-migration.md`](workshops/003-default-flip-migration.md) — Integration Pattern + State Machine + CLI Flow
- ✅ [`workshops/004-permission-prober-fleet.md`](workshops/004-permission-prober-fleet.md) — Integration Pattern + CLI Flow + Data Model (validation harness)

## Status Log

| Date | Status | Note |
|---|---|---|
| 2026-05-04 | 🛫 Specifying | Research dossier + 3 workshops + spec authored. 8 OQs pending clarify. |
| 2026-05-04 | ✅ Clarified | Simple mode chosen; Hybrid testing + targeted mocks; Hybrid docs (README + AGENTS_README + docs/how); companion preset = read-only + network override; Phase 6 expanded with `permission_status` MCP tool; config discovery exempted from FS guard; FX001/FX002/FX003 deferred follow-ups. |
| 2026-05-04 | ✅ Architected | Plan written: ~65 tasks across 6 release ordinals + stretch + 3 FX dossiers; 8 key findings; 5 domains modified; full domain manifest. Mode tension flagged: Simple-but-large; escalation path to per-release dossiers documented. |
| 2026-05-04 | ✅ Validated | `/plan-4` (5 inline validators) + `/validate-v2` (4 parallel agents): 1 HIGH (AC34 executable test) + 2 MEDIUM (T-R4.3 off-by-one, T-S2 MCP exemption) + 3 LOW fixed inline. Forward-compat re-run produced Outcome alignment line. Plan READY. |
| 2026-05-04 | 📦 Workshop 004 + plan fold | Authored workshop 004 (permission-prober validation fleet). Folded 8 new tasks into plan: T-R2.12 (prober pack), T-R2.13 (`minih probe` orchestrator), T-R3.9 (FS escape + coordinated scenarios), T-R4.10 (full 10-matrix), T-R6.5 (matrix gate in release notes), T-R6.6 (R6-binary verification), T-FX4 (outside-readback follow-up dossier). Total: 65 → ~73 tasks. Domain Manifest extended; Key Finding 09 added. |

---

**Next**: `/plan-2-v2-clarify` to resolve OQ1-OQ8, then `/plan-3-v2-architect`.
