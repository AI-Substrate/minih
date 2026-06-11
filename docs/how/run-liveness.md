# Run liveness — how minih decides a run is alive, dead, or stale

> Shipped by plan 025 (`docs/plans/025-dead-pid-liveness/`). Fixes issue #24:
> `minih status` used to report crashed runs as `active` — host agents polled,
> saw "active", and had to go digging.

## The vocabulary

| Surface | Values | Meaning of the dead-family values |
|---------|--------|-----------------------------------|
| `minih status` → `verdict` | `active` · `dead` · `stale` · `completed` · `failed` · `unknown` | `dead` = the manifest claims a live run but its recorded pid no longer exists. **Terminal** — the run will never finish. |
| `minih runs list/status` → `liveness` | same set | `dead` covers both unhealed corpses (manifest still says `active`) and healed ones (manifest says `crashed`). |
| `run.json` → `status` | `starting` · `active` · `idle` · `completing` · `completed` · `failed` · `crashed` · `stale` | `crashed` = written by `minih reconcile` when it healed a dead run. |
| `run.json` → `terminalReason` | `permission-denied` · `provider-stream-aborted` · `pid-vanished` | *Why* the run ended abnormally. Writers never overwrite an existing value. |

**`dead` vs `stale`**: `stale` is reserved for runs whose process is *alive*
but quiet (no events for >60s — maybe thinking, maybe wedged). `dead` is
proof-backed: the pid is gone. Before plan 025 both cases reported `stale`
(or even `active` within 60s of the crash) — that was the lie.

**Unrelated vocabulary — do not conflate**: peer-activity telemetry
(`peer.verdict: 'dead'` in coordination envelopes, plan 012) is a
*heartbeat-based* judgment about a peer agent's responsiveness, not a pid
probe. A peer can be `dead` there while its process is alive (known false
positive during long non-coordinated tool calls). This guide's `dead` is
strictly "the OS says that pid no longer exists".

## How the verdict is computed (`minih status`)

Decision order in `computeStatusVerdict` (exported from
`src/cli/commands/status.ts`, injectable `{isProcessAlive, now}` for tests):

1. `completed.json` exists → `completed` / `failed` (by `result`). The pid is
   **never probed** for terminal runs.
2. `run.json` says `crashed` → `dead`, no re-probe — the run was already
   healed and diagnosed; a recycled pid must not flip it back to alive.
3. `run.json` claims a live process (`starting`/`active`/`idle`/`completing`)
   and has a pid → probe with signal 0:
   - pid gone → **`dead`** (envelope gains `pid`, `pidAlive: false`,
     `lastEventAt`)
   - pid alive → fall through to the pre-existing mtime semantics
     (`active` if events flowed in the last 60s, else `stale`)
4. No probe possible → mtime semantics, else `unknown`.

### Probe error spec (FX009-3)

`process.kill(pid, 0)` can fail three ways; only one proves death:

| Errno | Meaning | Probe result |
|-------|---------|--------------|
| `ESRCH` | no such process | dead |
| `EPERM` | process exists, owned by someone else | **alive** (conservative — existence is what signal 0 probes; a falsely-dead verdict invites takeover of a live run) |
| `EINVAL` / anything else | bad signal / unknown | dead |

Non-positive or non-integer pids are dead without calling `kill`. The same
probe (`isProcessAliveDefault`) backs the resolver, the inventory, resume
eligibility, and `reconcile` — the EPERM upgrade applies to all of them.

## Healing: `minih reconcile`

`minih reconcile [slug] [--run <id>] [--all]` walks run dirs, probes
non-terminal manifests, and heals dead ones in place:

- `status` → `'crashed'`
- `terminalReason` → `'pid-vanished'` — **only when unset**. An existing
  diagnosis (e.g. `provider-stream-aborted` written by the adapter/runner at
  crash time) is never overwritten — the preservation invariant.
- Atomic writes; idempotent (healed runs leave the probe-eligible set).
- Lock-guarded per agents dir (`.reconcile.lock`, `'wx'` first-write-wins,
  stale-TTL + dead-owner steal). Contention → `E190 RECONCILE_IN_PROGRESS`.

After healing, the run drops out of `minih runs list --active` (the heal is
what removes it from the attention queue) but still shows `liveness: 'dead'`
in `--all`/default listings, with `manifestStatus: 'crashed'`.

## Migration notes for polling agents (breaking change)

```bash
# Terminal check — 'dead' belongs with completed/failed:
case "$(minih status my-agent 2>/dev/null | jq -r '.data.verdict')" in
  completed|failed|dead) echo "run is over" ;;
esac
```

- `select(.verdict == "active")` filters keep working and become *more*
  accurate — dead runs no longer masquerade as active/stale.
- **Target dead runs by id**: plain `minih status <slug>` resolves the latest
  *live* run; if the slug's only run died, the resolver finds no active
  candidate and no completed fallback, and you get `E171 "No runs found"`
  (pre-existing resolver behavior, unchanged by this plan). Host agents
  should keep the `runId` from the `minih run` envelope and poll
  `minih status <slug> --run <runId>`, or sweep with `minih runs list`
  (which reports `dead` per row).

## Deliberate asymmetry: the resolver stays mtime-only

`run-resolver.ts` has its own `computeLiveness` that is *not* pid-probing —
by design. Its active-run **collection** path (`collectActiveRuns`) already
probes pids and skips dead candidates (plan 016), so a second probe in its
liveness projection would be redundant work on every resolve. The surfaces
that *report* liveness to humans/agents (`status`, `runs`) carry the probe.
