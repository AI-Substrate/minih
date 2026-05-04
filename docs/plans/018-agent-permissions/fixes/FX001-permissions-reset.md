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

Single shared file: `~/.minih/permissions-edits.log` (NDJSON, append-only).

```json
{"ts":"2026-05-04T16:07:00Z","command":"reset","slug":"my-agent","before":{"lockedDefault":"yolo"},"after":{},"reason":"user-reset","cwd":"/path/to/project"}
{"ts":"2026-05-04T16:08:00Z","command":"set","slug":"my-agent","before":{"preset":"yolo"},"after":{"preset":"restricted"},"cwd":"..."}
```

Replaces the original FX001 `~/.minih/permissions-resets.log` proposal — one journal for ALL permission edits, not per-command.

## Acceptance criteria

### Reset command
- AC-FX1.1: `reset <slug>` clears `lockedDefault*` fields from sidecar.
- AC-FX1.2: `--to <preset>` writes `lockedDefault: <preset>` + `lockedDefaultReason: 'user-reset'`.
- AC-FX1.3: Without `--yes`, prints confirmation including current and new values.
- AC-FX1.4: Refuses agents without sidecar (E183-class — points at `permissions set`).

### Unified audit trail
- AC-FX1.5: Every successful `set` / `clear` / `migrate` / `reset` appends one NDJSON line to `~/.minih/permissions-edits.log`.
- AC-FX1.6: Failed commands do NOT write a line (no partial state in journal).
- AC-FX1.7: Log directory is created with `mkdir -p` if missing; failure to write the log does NOT fail the command (best-effort, stderr-warned).
- AC-FX1.8: Log line schema is stable and documented in `docs/how/permissions.md`.
- AC-FX1.9: `MINIH_PERMISSIONS_AUDIT_LOG` env var overrides the path (CI / containerised installs).

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
