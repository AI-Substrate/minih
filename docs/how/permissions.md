# Permissions

> Plan 018 — fine-grained agent permissions for minih. Replaces the
> previous hard-coded `approveAll` (yolo) posture with an opt-in policy
> compiled from agent frontmatter.

## TL;DR

Add a `permissions:` field to your agent's `prompt.md` frontmatter:

```yaml
---
description: My agent
permissions: read-only
---
```

That's it. The agent now runs with no shell, write, or network access; only
read + MCP. If it tries anything else, the run terminates with exit code
`126` and a `permission-error` envelope on the outside inbox (coordinated
agents only).

## The six built-in presets

| Preset      | shell | write | read | mcp | url | custom-tool | memory | hook |
|-------------|-------|-------|------|-----|-----|-------------|--------|------|
| `yolo`      | ✅    | ✅    | ✅   | ✅  | ✅  | ✅          | ✅     | ✅   |
| `trusted`   | ✅    | ✅    | ✅   | ✅  | ✅  | ❌          | ❌     | ❌   |
| `restricted`| ❌    | ❌    | ✅   | ✅  | ❌  | ❌          | ❌     | ❌   |
| `read-only` | ❌    | ❌    | ✅   | ✅  | ❌  | ❌          | ❌     | ❌   |
| `network`   | ❌    | ❌    | ✅   | ✅  | ✅  | ❌          | ❌     | ❌   |
| `build-only`| ✅    | ✅    | ✅   | ❌  | ❌  | ❌          | ❌     | ❌   |

Pick one; tweak with `overrides` if needed.

## Object form (overrides + allowedRoots)

```yaml
permissions:
  preset: read-only
  overrides:
    network: allow         # `network` is an alias for `url`
    shell: allow
  allowedRoots:
    mode: extend           # `extend` (default) or `replace`
    roots: ["./repo", "./tmp"]
```

### `overrides`

Per-kind override layered on the preset. Keys: `shell`, `write`, `read`,
`mcp`, `url` (or `network`), `custom-tool`, `memory`, `hook`. Values:
`allow` | `deny` | `prompt-user` (last is reserved for FX002).

### `allowedRoots`

FS guard scope. By default the agent can read/write only inside the
discovered git root (or the current working directory if no git).

- `mode: extend` — adds `roots[]` to inherited list
- `mode: replace` — wipes everything below this layer

Composition order (highest precedence last): harness → frontmatter → env →
CLI flags.

## Resolution chain

When `runAgent` starts, the policy resolves through 4 layers in order:

1. `prompt.md` frontmatter `permissions:` (explicit)
2. `.minih-source.json` sidecar `lockedDefault` (R3+)
3. `MINIH_PERMISSIONS_DEFAULT` env var
4. Release-default constant (R1-R5: `yolo`; R6+: `restricted`)

Whichever layer first specifies a preset wins. Overrides stack
(frontmatter > sidecar > env > none).

## What happens on denial

When the SDK requests permission and the policy says `deny`:

1. Adapter emits `permission_denied` AgentEvent.
2. Runner fires the **5-signal protocol** (workshop 002 § Q1):
   - `events.ndjson` (mandatory) — already written by the adapter event
   - `run.json.terminalReason: 'permission-denied'` (mandatory) +
     `permissionError` payload
   - `state/inside.json` (best-effort, coordinated only) — set to
     `status: 'error'` with payload
   - `inbox/outside/messages.ndjson` (best-effort, coordinated only) —
     `permission-error` typed message
   - Exit code `126` (POSIX "permission denied")

The denial is **terminal** — the run stops immediately. There is no
retry-from-checkpoint. Idempotent on `requestId` so a re-asked permission
fires once.

## Threat model & residual risks

The FS guard is **best-effort against well-behaved-but-mistaken agents,
NOT adversarial**.

- **TOCTOU (time-of-check-to-time-of-use)**: Node lacks `openat()`. We
  realpath each access, but a symlink can be re-pointed between our check
  and the kernel's open. Mitigation: short check-to-open windows; for
  hostile threat models combine with `--strict-fs` (Phase 6 stretch) or
  OS-level isolation (containers / chroot / firejail).
- **Symlink escapes**: realpath-each-access catches static symlinks; we
  do NOT track per-process symlink state.
- **Forbidden roots**: `/`, `/etc`, `/usr`, `/bin`, `/sbin`, `/System`,
  `/Windows` are refused even if the user explicitly lists them.
- **Network gating is coarse**: `url` allow/deny gates at the SDK kind
  level; we don't whitelist hosts/ports yet.

## Error codes

| Code | Symbol | When |
|---|---|---|
| `E200` | `PERMISSION_DENIED` | A run was terminated for permission denial |
| `E201` | `ALLOWED_ROOTS_INVALID` | `allowedRoots` composition resolved to empty |
| `E202` | `FORBIDDEN_ROOT` | `allowedRoots` includes `/`, `/etc`, etc. |
| `E203` | `PERMISSIONS_FRONTMATTER_INVALID` | Bad shape in `permissions:` field |
| `E204` | `PERMISSION_PRESET_UNKNOWN` | Preset name not in the registry |
| `E205` | `COORDINATION_WRITE_DENIED` | Coordinated agent's resolved policy denies `write` (FX008 boot precondition) |

## Coordinated agents

A `coordination: enabled` agent is contractually required to write
`output/report.json` on `control:stop` or idle-budget exit (workshop
002 § Q1, [`docs/how/companion-mode.md`](./companion-mode.md)). If its
resolved policy denies `write`, the run cannot persist its canonical
farewell envelope — the run looks "completed" but every consumer of
`output/report.json` finds the file absent.

`minih run` enforces this at boot. When `coordination: enabled` and
`decisions.write === 'deny'`, the runner refuses to start the SDK
session and fires the standard 5-signal denial protocol with
**`E205 COORDINATION_WRITE_DENIED`**. Sample message:

```
E205 COORDINATION_WRITE_DENIED — Coordinated agent 'my-coord-agent' resolved to preset
'read-only' which denies write. Coordinated agents MUST write
output/report.json on exit (workshop 002 § Q1, docs/how/companion-mode.md).

Resolved from: frontmatter

Remediations (pick one):
  1. Add `write: allow` to the agent's frontmatter `permissions.overrides`.
     Edit:  <agentDir>/prompt.md
  2. Pick a preset that allows write at the same source layer:
     `trusted` (allows shell+write+url) or `yolo` (allows everything).
  3. Pass --allow-coord-write-deny when running the agent (operator
     acknowledges the run cannot persist its envelope; you must be sure).
```

`Resolved from:` names which layer of the resolution chain
(`frontmatter` / `sidecar` / `env` / `release-default`) supplied the
preset, so operators edit the right place. If the source is `sidecar`,
the message also suggests `minih agent permissions reset <slug>` (FX001)
to clear sticky lockedDefault values.

### `--allow-coord-write-deny` (per-invocation opt-out)

```bash
minih run <slug> --allow-coord-write-deny
```

Boots the run despite the structural inability to ship
`output/report.json`. Per-invocation only — there is **no env-var
fallback** for this opt-out (intentional: it must never be silently
inherited from a shell config).

Every successful invocation with the flag set emits an anchored stderr
banner so operator usage is traceable in shell history / CI logs:

```
[minih] Warning: --allow-coord-write-deny set; canonical session record will not be persisted (slug='X', preset='Y').
```

You almost certainly don't want this. Use it only for legitimately
read-only coordinated agents that intentionally don't persist a
farewell envelope (rare).

### `MINIH_DISABLE_COORD_WRITE_PRECONDITION` (ops emergency rollback)

If an upstream change to FX008 produces a regression for an entire
fleet of coordinated agents, ops can set this env var as a temporary
rollback path that doesn't require a code deployment:

```bash
export MINIH_DISABLE_COORD_WRITE_PRECONDITION=1
minih run <slug>
```

Accepts `1` or case-insensitive `true`. Any other value (including
absent) leaves the precondition active.

When the kill-switch bypasses, every fire emits an anchored stderr
banner naming the agent, so an ops-wide search of CI / agent logs
quickly enumerates affected runs:

```
[minih] Warning: MINIH_DISABLE_COORD_WRITE_PRECONDITION is set; coord agent 'X' booted with write-deny policy. Re-enables silent-failure mode FX008 was designed to eliminate.
```

**Use only as a temporary rollback mechanism.** It re-enables exactly
the silent-failure surface FX008 was designed to eliminate. The right
remedy is to land a fix or revert the upstream change, not to keep the
kill-switch on.

## Companion preset

The canonical pattern for a code review companion (read-mostly with `gh`
CLI access for fetching diffs):

```yaml
permissions:
  preset: read-only
  overrides:
    network: allow         # gh CLI talks to the GitHub API
    shell: allow           # gh CLI runs as a shell tool
```

## Config-discovery exemption (AC34)

The SDK's automatic AGENTS.md / config-discovery walk reads files outside
`allowedRoots` (e.g., `~/AGENTS.md`). This is **exempt** from the FS
guard — discovery is a runtime-managed concern, not user-controlled file
access. Discovery reads do NOT fire `permission_denied`.

If you need to gate discovery itself, set `enableConfigDiscovery: false`
on the agent's frontmatter (currently runner-internal; user-facing surface
deferred to FX002).

## CLI surface (R2+)

```bash
minih agent permissions list-available           # show all 6 presets + matrix
minih agent permissions list <slug>              # raw frontmatter policy
minih agent permissions list <slug> --effective  # resolved after all layers
minih agent permissions set <slug> <preset>      # write to frontmatter
minih agent permissions clear <slug>             # remove the field
minih agent permissions migrate <slug>           # heuristic recommendation
minih agent permissions migrate --all --yes     # bulk migrate all agents

# Per-run overrides
minih run <slug> --permissions <preset>
minih run <slug> --allowed-roots <p1,p2>          # extend
minih run <slug> --allowed-roots-only <p1,p2>     # replace
minih run <slug> --strict-fs                       # opt-in Layer-(b) FS sandbox
minih run <slug> --dry-run-permissions             # resolve without running
minih run <slug> --allow-coord-write-deny          # FX008 opt-out (see § Coordinated agents)
```

## Migration path

Plan 018 ships in 6 individually-reversible releases:

- **R1**: Schema + types arrive; no behaviour change
- **R2**: `doctor` warns on un-migrated agents; CLI tooling lands; `MINIH_PERMISSIONS_DEFAULT` escape hatch
- **R3**: `agent install` captures recommended permissions per pack
- **R4**: All first-party agents declare permissions explicitly; fft-blocking regression added
- **R5**: New agents (via `init` / `agent install`) default to `restricted`; existing agents preserved
- **R6**: Universal default flips `yolo` → `restricted`. Sidecar `lockedDefault` preserves grandfathered intent.

Run `minih agent permissions migrate <slug> --dry-run` to see what each
agent would get under the recommended-defaults heuristic.
