# Per-repo Copilot home isolation

minih wraps the GitHub Copilot SDK, which spawns a Copilot CLI runtime to do the
actual work. By default that runtime stores **everything** — session history,
`session-store.db`, logs, config, embedding cache, auth — in `~/.copilot`, the
*same* home your interactive `copilot` CLI uses. The result: every minih run
piles sessions into your personal store, bloating it and cluttering
`copilot --resume`.

minih fixes this by pointing the SDK at a **per-repo, git-ignored home**:

```
<repo>/.minih/copilot-home/
```

So minih's Copilot sessions are physically separate from your `~/.copilot` store
and trivially findable per repo. This is done by setting the SDK client option
`baseDirectory` (which becomes `COPILOT_HOME` on the spawned runtime) at the one
place minih constructs the client (`src/cli/commands/sdk-runtime.ts`), shared by
`minih run` and `minih resume`.

## What this changes

- **Sessions land in `<repo>/.minih/copilot-home/`**, never in `~/.copilot`. Your
  `copilot --resume` (run from anywhere) no longer lists minih's runs.
- **Auth still works on the fresh home.** A new home has no `~/.copilot/m-auth`,
  so minih passes your `GH_TOKEN` explicitly as the SDK `gitHubToken` option
  (the SDK then uses token auth instead of the logged-in user). `GH_TOKEN` is
  already required to run minih.
- **`.minih/` is git-ignored** (directory-only rule), while the tracked
  `.minih.json` config file is unaffected.

## Environment variables (operator-facing)

These are read by the **minih CLI process** at run/resume start — they are not
part of the in-session agent preamble.

| Variable | Default | Purpose |
|----------|---------|---------|
| `MINIH_COPILOT_HOME` | `<cwd>/.minih/copilot-home` | Override where the Copilot store lives. Useful to point several repos at one home, or to relocate it off the repo. |
| `MINIH_COPILOT_LOG_LEVEL` | `info` | Runtime log verbosity. One of `none`, `error`, `warning`, `info`, `debug`, `all`. An **unset or invalid** value falls back to `info` (an out-of-range string never reaches the SDK). Set `error` to keep the per-repo logs small. |
| `MINIH_COPILOT_HOME_WARN_MB` | `500` | Threshold (MB) for the large-logs warning. When the files directly under `<home>/logs` exceed it, minih prints a single stderr line on run/resume start naming the directory and the remedy. Below the threshold (or with no `logs` dir) it is silent. |

## Notes

- **Per repo, not global.** The home is anchored to `process.cwd()` (the repo
  root, matching minih's `{{REPO_ROOT}}`). Running minih from a subdirectory
  would create `.minih/` there — run from the repo root.
- **Existing sessions are not migrated.** Sessions already in `~/.copilot` from
  past minih runs stay there; this change only affects new runs. Clean them up
  manually if you want.
- **The cwd-isolation layer is unchanged and complementary.** minih still sets
  the SDK `workingDirectory` to the per-run folder; `baseDirectory` is a
  separate, client-level knob that relocates the whole store.
- **Out of scope:** the SDK's per-session `configDirectory` (distinct from
  `baseDirectory`) and minih's `configDir`→`configDirectory` field-name mismatch
  are tracked separately, not by this feature.
