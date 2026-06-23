# Research Report: Per-repo Copilot SDK session isolation (`COPILOT_HOME` under `./.minih`)

**Generated**: 2026-06-23
**Research Query**: "Store Copilot SDK sessions under a per-repo, git-ignored `./.minih` so they stop polluting the main `copilot` CLI resume list; toggleable log level (default info) + a CLI warning when an area's logs grow large."
**Mode**: Pre-Plan (Simple)
**Findings**: curated below (lean — basic explore, not a full fan-out)

## Executive Summary

### What we're changing
minih wraps `@github/copilot-sdk` (1.0.1). Every agent run spawns the Copilot CLI runtime, which by default stores **all** its data — session history, config, logs, embedding cache — in `~/.copilot` (the *same* home the user's interactive `copilot` CLI uses). Today minih only hides its runs from `copilot --resume` via **CWD isolation**; the sessions still physically accumulate in the shared `~/.copilot` store. We will point the SDK at a **per-repo, git-ignored `./.minih/copilot-home`** so minih's sessions are physically separate and trivially findable per repo.

### Key insights
1. **One knob does it**: the SDK client option `baseDirectory` sets `COPILOT_HOME` on the spawned runtime; default `~/.copilot`. Repoint it → the whole store relocates. (`node_modules/@github/copilot-sdk/dist/types.d.ts:170-176`; `client.js:1376-1377`)
2. **Current isolation is CWD-based, not storage-based** — it filters the resume list by cwd but leaves sessions in the shared store (which has grown to 82 MB `session-store.db` + 1,228 `session-state/` dirs in `~/.copilot`). A separate `COPILOT_HOME` is the storage-level fix and is **orthogonal/compatible** with the cwd layer.
3. **Auth must be handled**: a fresh empty home loses `~/.copilot/m-auth`, but minih already requires `GH_TOKEN`. Passing it explicitly as `gitHubToken` makes auth independent of the home dir.

## The one knob: `COPILOT_HOME` via `baseDirectory`

| Field | Level | Effect | Evidence |
|---|---|---|---|
| `baseDirectory` | **client** (constructor) | Sets `COPILOT_HOME` env on the spawned runtime → relocates **all** Copilot data (session-store.db, session-state/, history-session-state/, config.json, settings.json, mcp-config.json, embedding-cache, logs, m-auth). Default `~/.copilot`. | `types.d.ts:170-176`; `client.js:1376-1377` (`envWithoutNodeDebug.COPILOT_HOME = this.options.baseDirectory`) |
| `configDirectory` | **session** | Overrides only the per-session config dir. **Distinct** from `baseDirectory`. | `types.d.ts:1287`; `client.js:812,967` |

The knob we want is **`baseDirectory`** (client-level) — it moves the session store wholesale.

## How it works today (the gap)

- minih sets the SDK session `workingDirectory = runDir`; the Copilot CLI records that `cwd` in each session's `workspace.yaml`; `copilot --resume` filters by cwd, so minih runs don't appear *from the project root*. (`docs/plans/001-setup/workshops/005-session-isolation-cwd-strategy.md`)
- **But** the sessions still live in shared `~/.copilot/session-store.db` + `session-state/`. They bloat the store and remain visible to any non-cwd-filtered picker / a `--resume` run from inside a run dir. **That is the pollution being reported.**

## Fix surface (single site)

The Copilot client is constructed in exactly one place, shared by both `run` and `resume`: **`src/cli/commands/sdk-runtime.ts:105-118`**. Today it passes only `{ onGetTraceContext, telemetry }`. The change:

```ts
const copilotHome =
  process.env.MINIH_COPILOT_HOME ?? path.join(process.cwd(), '.minih', 'copilot-home');
fs.mkdirSync(copilotHome, { recursive: true });
const logLevel = (process.env.MINIH_COPILOT_LOG_LEVEL ?? 'info'); // toggleable, default info
warnIfHomeLogsLarge(copilotHome); // CLI warning, see below

new CopilotClient({
  onGetTraceContext: () => { /* unchanged */ },
  baseDirectory: copilotHome,        // → COPILOT_HOME on the spawned runtime
  gitHubToken: process.env.GH_TOKEN, // auth without ~/.copilot/m-auth (see Auth)
  logLevel,
  ...(otlpEndpoint && { telemetry: { otlpEndpoint } }),
});
```

Plus `.gitignore`: add `.minih/` (the tracked `.minih.json` file is unaffected by a directory-only rule; `agents/*/runs/` is already ignored at line 145).

`process.cwd()` is the repo root in both `run.ts` and `resume.ts` (it's what `{{REPO_ROOT}}` resolves to — `run.ts:598`).

## Auth (must-handle, but clean)

- minih hard-gates on `GH_TOKEN` at `sdk-runtime.ts:52-61`, but does **not** pass `gitHubToken` to the constructor — it relies on the SDK default `useLoggedInUser:true` (keytar / `~/.copilot/m-auth` / gh CLI). (`client.js` ~262, 1356-1371)
- A fresh `.minih/copilot-home` has no `m-auth`. `gh` CLI auth (reads `~/.config/gh`, **not** `COPILOT_HOME`) still works, but the robust guarantee is to **pass `gitHubToken: process.env.GH_TOKEN`** → SDK sets `COPILOT_SDK_AUTH_TOKEN` on the subprocess (`client.js:1370-1371`); token is in-memory, independent of the home dir.

## "Replicate config" question (the user's instinct)

A fresh home loses everything in `~/.copilot`, but almost all of it is already handled or irrelevant:

| `~/.copilot` content | Lost on fresh home? | Handled because |
|---|---|---|
| Auth (`m-auth`, keytar) | yes | minih requires `GH_TOKEN`; pass it as `gitHubToken` ✅ |
| Model / effort (`settings.json`: gpt-5.5, xhigh) | yes | minih sets model + reasoning per-run ✅ |
| MCP servers (`mcp-config.json`: flowspace, perplexity) | yes | minih threads `mcpServers` explicitly per-run ⚠️ (see side-finding) |
| Plugins (`workiq`), skills | yes | minih passes `skillDirectories`; plugins lost unless seeded |
| embedding-cache.db | yes | perf only, regenerates ✅ |
| permissions-config.json | yes | minih runs yolo (`approveAll`) — irrelevant ✅ |

**Net**: with `gitHubToken` passed + minih's existing per-run model/mcp/skill threading, a fresh per-repo home works without seeding anything. Optional: seed `mcp-config.json`/`settings.json` from `~/.copilot` only if the user wants user-level MCP/plugins.

## Decisions captured (from the user)

1. **Location**: per-repo `./.minih/copilot-home`, **git-ignored** — findable per repo. (not a single global `~/.minih`)
2. **Log level**: **toggleable**, default `info`. Env: `MINIH_COPILOT_LOG_LEVEL`.
3. **Large-logs warning**: minih **warns on CLI usage when an area's logs grow large**. Default threshold ~500 MB, overridable via `MINIH_COPILOT_HOME_WARN_MB`. Shallow-sum `<home>/logs/` (cheap even when huge) on run/resume start; one stderr line naming the area + remedy.
4. **Keep it simple** — Simple mode, no boil-the-ocean.

New env vars (operator-facing — read by the CLI process, not the in-session agent): `MINIH_COPILOT_HOME`, `MINIH_COPILOT_LOG_LEVEL`, `MINIH_COPILOT_HOME_WARN_MB`.

## Side-finding (verified — separate from this work)

🚨 **minih's per-session config dir is silently dropped.** minih passes `configDir` (`sdk-copilot.ts:152,163`; `copilot-types.ts:66,77`), but the SDK session field is `configDirectory` (`types.d.ts:1287`; `client.js:812,967` `configDir: config.configDirectory`). TypeScript misses it because minih checks against its own mirror interface, not the real SDK type; **no test asserts forwarding** (`test/runner/mcp.test.ts` only checks the local signature accepts it). So `runner.ts:1387`'s intended `~/.copilot/mcp-config` pickup is **not happening**. This is a *per-session* knob (distinct from `baseDirectory`/`COPILOT_HOME`) — note it, decide in the plan whether to fix here or file separately.

## Prior art (all AGREE or NEUTRAL — no conflicts)

| Doc | Summary | Stance |
|---|---|---|
| `001-setup/workshops/005-session-isolation-cwd-strategy.md` | CWD isolation hides minih runs from `copilot --resume`; sessions live globally in `~/.copilot`. | AGREE (orthogonal — keep cwd layer) |
| `007-backgrounding/research-dossier.md` PL-02 | "Background daemon must keep `workingDirectory=runDir`. Do NOT centralize sessions in a single CWD." | AGREE — `baseDirectory` ≠ cwd; both coexist. **Keep per-run cwd buckets.** |
| `003-resume-prompt/research-dossier.md` | Sessions persist in `~/.copilot/session-state/<uuid>/`; minih uses `disconnect()` (no destroy) so resume works. | NEUTRAL |
| `005-mcp-config/research-dossier.md` | `configDir` is independent of `workingDirectory`; MCP discovery walks to git root. | AGREE (same independence applies to `baseDirectory`) |
| `022-minih-skills-config/workshops/001-...` | `~/.copilot/skills` is the personal skills location. | NEUTRAL (skills live under `COPILOT_HOME/skills` — same structure in new home) |

## Watch-outs (for the plan)

- **Per-repo logs can bloat** — `~/.copilot/logs` reached 1.2 GB. Hence the toggle (default info) + the large-logs warning (decision 3).
- **Existing pollution isn't auto-cleaned** — past minih sessions already in `~/.copilot` stay; out of scope unless we add a cleanup note.
- **`process.cwd()` from a subdirectory** would create `.minih` there; acceptable (matches existing `{{REPO_ROOT}}` semantics). Anchor to git toplevel only if desired.
- **`configDir` side-finding** — decide fold-in vs separate issue.

## External research opportunities
None — the SDK behavior is verified directly from `node_modules/@github/copilot-sdk/dist` source and prior plans; no external knowledge gaps.
