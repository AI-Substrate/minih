# FX001 — `permissions reset` + unified audit trail for permissions edits

**Status**: DEFERRED (post-R6)
**Plan**: 018-agent-permissions
**Origin**: Spec OQ4 — "Should there be a way to clear `lockedDefault`?" + top-10 follow-up #2/#8 (operator safety net).
**Resolution**: YES — ship reset + journal every permissions-edit command.

## Motivation

Two related gaps in the post-R6 surface area:

**1. Lossless `lockedDefault` has no escape hatch.** R3 sidecar `lockedDefault` is intentionally lossless — once an install captures intent, no later minih binary will overwrite it (workshop 003 § Q3). But operators who picked the wrong preset at install time, or want to opt into an upstream `recommended` change, or are debugging the resolution chain, currently have to hand-edit JSON.

**2. `permissions set` / `clear` / `migrate` rewrite frontmatter idempotently with no journal.** A bulk migration gone wrong has nothing to revert from. A single append-only JSONL audit log restores operator confidence at trivial cost.

Both surface concerns share the same audit-log pattern, so we ship them as one dossier.

## Scope

### CLI surface

```bash
# Sticky-default reset (the original FX001 scope)
minih agent permissions reset <slug>
  [--to <preset>]              # set to a specific preset instead of clearing
  [--reason "<text>"]
  [--yes]

# Existing edit commands gain audit trail (no surface change)
minih agent permissions set <slug> <preset>
minih agent permissions clear <slug>
minih agent permissions migrate <preset>
```

### Audit log

Single shared file at `<homedir>/.minih/permissions-edits.log` (NDJSON, append-only).

**Path resolution**: `path.join(os.homedir(), '.minih', 'permissions-edits.log')`. On Windows `os.homedir()` returns `C:\Users\<user>` — the same code path applies unchanged. Do NOT rely on shell tilde expansion. Override via `MINIH_PERMISSIONS_AUDIT_LOG` env var (AC-FX1.9).

**File mode**: created with `0600` (owner read/write only) via `fs.open(path, 'a', 0o600)`. Logs may contain filesystem paths and slug names — treated as sensitive (per AC-FX1.10).

**`~/.minih/` namespace ownership** (forward-compat with FX002 dry-run journal): this dossier reserves `permissions-edits.log` for state-mutating commands (set/clear/migrate/reset). Sibling files in the same directory (e.g. `permissions-checks.log` from a future FX002 implementation) MUST follow the same NDJSON shape with `ts`/`command`/`slug` headers. FX001 owns directory creation; future fixes consume.

```json
{"ts":"2026-05-04T16:07:00Z","command":"reset","slug":"my-agent","before":{"lockedDefault":"yolo"},"after":{},"reason":"user-reset","cwd":"/path/to/project"}
{"ts":"2026-05-04T16:08:00Z","command":"set","slug":"my-agent","before":{"preset":"yolo"},"after":{"preset":"restricted"},"cwd":"..."}
```

`command` is one of the closed enum: `reset` | `set` | `clear` | `migrate`. Future commands extend this enum via additive update; readers MUST tolerate unknown values.

Replaces the original FX001 `~/.minih/permissions-resets.log` proposal — one journal for ALL permission edits, not per-command. Existing installs with the legacy file: implementer MUST emit a stderr notice on first write to `permissions-edits.log` if `permissions-resets.log` is detected: `[minih] Notice: legacy log at <homedir>/.minih/permissions-resets.log is superseded; entries have not been merged.` Migration of legacy entries is out of scope.

**Concurrent-write semantics**: on POSIX, `fs.appendFile` for lines ≤ 4 KB is append-atomic. On Windows it is NOT — concurrent `minih agent permissions ...` invocations may interleave bytes for long lines. For the initial implementation, accept the risk and document: "Corrupt lines are silently ignored by any future reader; schema-validation on read is the recovery path." A write-lock file (`permissions-edits.lock`) can be added later if real-world races appear.

**Domain ownership**: the audit writer lives at `src/cli/audit-log.ts` (cli-domain) exported as a pure function `appendAuditLine(entry, opts?): Promise<void>`. Runner does NOT write the audit log directly; runner events trigger it only through the CLI command layer. This keeps the import graph clean (cli → {mcp, runner, adapter}; never inverse).

### Error code: AC-FX1.4 sidecar-missing

The current error registry has E183 = `AGENT_PACK_ALREADY_INSTALLED` (install-time error, semantically different). For permissions-reset on a hand-rolled agent (no sidecar), allocate a NEW code: **E185 `AGENT_NO_SIDECAR`** with message `"Agent <slug> has no sidecar; permissions reset requires a managed pack. Use \`minih agent permissions set\` to set frontmatter directly."` Document this in `src/cli/output.ts` and `docs/how/permissions.md` § Errors.

## Acceptance criteria

### Reset command
- AC-FX1.1: `reset <slug>` clears exactly two sidecar fields: `lockedDefault` AND `lockedDefaultReason`. Other `lockedDefault*` keys (if any are added in future schema bumps) MUST be enumerated in the sidecar schema before this AC covers them — implementer MUST NOT silently delete unrecognised keys.
- AC-FX1.2: `--to <preset>` writes `lockedDefault: <preset>` + `lockedDefaultReason: 'user-reset'`.
- AC-FX1.3: Without `--yes`, prints current/new values and prompts `Confirm? [y/N]`. On decline (or any non-`y` response): exits 0 with message `Aborted.` and writes NO log line. On confirm: proceeds. In non-interactive environments (`!process.stdin.isTTY`), `--yes` is REQUIRED; absent it, exit 1 with message `Use --yes to confirm in non-interactive mode.`
- AC-FX1.4: Refuses agents without sidecar with exit code via E185 `AGENT_NO_SIDECAR` (see § Error code above). Message points at `permissions set`.

### Unified audit trail
- AC-FX1.5: Every successful `set` / `clear` / `migrate` / `reset` appends one NDJSON line to the audit log path (default `<homedir>/.minih/permissions-edits.log`; override via `MINIH_PERMISSIONS_AUDIT_LOG`).
- AC-FX1.6: Failed commands do NOT write a line (no partial state in journal).
- AC-FX1.7: Log directory is created with `fs.mkdir(..., { recursive: true })` if missing; failure to write the log does NOT fail the command (best-effort). On failure, print stderr message MATCHING the regex `^\[minih\] Warning: could not write audit log at .+: .+$` (e.g., `[minih] Warning: could not write audit log at /home/u/.minih/permissions-edits.log: ENOSPC`). Test fixture mocks `fs.appendFile` to throw `ENOSPC` and asserts stderr matches the regex.
- AC-FX1.8: `docs/how/permissions.md` contains a § "Audit log schema" section with: (a) the full TypeScript interface `AuditLogEntry`, (b) the closed `command` enum, (c) at least one example JSON line. A snapshot test in the Testing suite asserts the actual serialised line matches the documented schema (field names + types).
- AC-FX1.9: `MINIH_PERMISSIONS_AUDIT_LOG` env var overrides the path (CI / containerised installs). Empty string disables logging entirely (treated as best-effort failure, stderr-silent).
- AC-FX1.10: Log file is created with mode `0600`. Test fixture asserts `fs.statSync(logPath).mode & 0o777 === 0o600` on POSIX. Skipped on Windows (`process.platform === 'win32'`) — Windows has no equivalent mode bits.
- AC-FX1.11: Env-var namespace `MINIH_PERMISSIONS_*` is shared with FX003 and any future permissions dossiers. New `MINIH_PERMISSIONS_*` vars MUST add a row to `docs/how/permissions.md` § "Environment variables" before merge.

## Out of scope
- Bulk `reset --all` — sticky-default reset is per-agent by design.
- Auto-revert from journal — humans replay manually if needed.
- Network telemetry — journal stays local.

## Risks
- Trust loss after regret — mitigated by audit + `--yes` confirm.
- Race with `agent install` upgrade — install always writes fresh sidecar; audit captures the install too if invoked via CLI.
- Log file unbounded growth — accept; the install rate is low and the rows are small. Document optional logrotate stanza.

## Testing
- TDD on sidecar mutator (3 fixtures: present / absent / corrupt).
- Lightweight CLI integration for each of the 4 commands writes one journal line.
- One snapshot test for journal line shape (per AC-FX1.8).
- `MINIH_PERMISSIONS_AUDIT_LOG` honoured under env override.

---

## Validation Record (2026-05-04)

| Agent | Lenses Covered | Issues | Verdict |
|-------|---------------|--------|---------|
| Source-Truth | Technical Constraints, Hidden Assumptions, Concept Documentation | 1 MEDIUM (E183 ambiguity) → fixed inline (E185 allocated) | ⚠️ → ✅ |
| Cross-Reference | Integration & Ripple, Concept Documentation, Hidden Assumptions | 0 (FX001↔FX002 path no collision; OQ4 ref correct) | ✅ |
| Completeness | Edge Cases, Security & Privacy, Deployment & Ops, Domain Boundaries | 2 CRITICAL + 4 HIGH + 4 MEDIUM → all fixed inline | ⚠️ → ✅ |
| Forward-Compatibility | Forward-Compatibility (Lifecycle ownership, Encapsulation lockout) | 1 HIGH (~/.minih/ namespace) + 1 LOW (env var registry) → fixed inline | ⚠️ → ✅ |

**Lens coverage**: 9/12 (above 8 floor).

**Fixes applied**: Windows path resolution (os.homedir), `lockedDefault*` enumeration (lockedDefault + lockedDefaultReason), concurrent-write semantics, legacy log migration notice, file mode 0600 + paths-as-PII note, AC-FX1.3 decline + non-TTY behaviour, E185 allocation, AC-FX1.7 stderr regex format, AC-FX1.8 schema doc requirement, cli-domain ownership at `src/cli/audit-log.ts`, namespace ownership for FX002 forward-compat, env-var registry note (AC-FX1.11).

**Overall**: ⚠️ VALIDATED WITH FIXES — ready for `/plan-6 --fix FX001` cycle.
