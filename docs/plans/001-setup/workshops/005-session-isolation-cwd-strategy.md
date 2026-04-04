# Workshop: Session Isolation & CWD Strategy

**Type**: Integration Pattern
**Plan**: 001-setup
**Spec**: miniharness-extraction-spec.md
**Created**: 2026-04-04T04:55:00Z
**Updated**: 2026-04-04T05:00:00Z
**Status**: Draft

**Related Documents**:
- [003 Agent Folder Convention](./003-agent-folder-convention.md) — run folder structure
- [002 CLI Command Design](./002-cli-command-design.md) — run command flow

---

## Purpose

Design how minih isolates Copilot SDK sessions from the user's normal coding sessions. The SDK stores all sessions globally in `~/.copilot/session-state/<uuid>/` — each session records its `cwd` in `workspace.yaml`. When a user runs `copilot --resume` from a directory, it filters sessions by matching CWD. If minih agent runs use the project root as CWD, those sessions appear alongside the user's real coding sessions, polluting the `--resume` experience.

---

## How the SDK Stores Sessions

Sessions are stored **globally** at `~/.copilot/session-state/`, not in the project:

```
~/.copilot/
├── session-state/
│   ├── <uuid-1>/
│   │   ├── workspace.yaml       ← records cwd, git_root, branch, summary
│   │   ├── events.jsonl
│   │   ├── checkpoints/
│   │   └── files/
│   ├── <uuid-2>/
│   └── ... (hundreds of sessions)
├── command-history-state.json
├── config.json
└── logs/
```

Key fields in `workspace.yaml`:
```yaml
id: 0046d244-4632-42f0-a4ad-8468ccd3aac9
cwd: /Users/user/project              # ← --resume filters on this
git_root: /Users/user/project
repository: owner/repo
branch: main
summary: "Working on auth module"
```

**`--resume` shows sessions whose `cwd` matches the current directory.** Setting the SDK's `workingDirectory` to the run folder means those sessions record a different `cwd` — they won't appear when the user runs `--resume` from the project root.

---

## The Problem

```
$ cd /my/project
$ copilot --resume

  Recent sessions in /my/project:

  1. "Working on auth module"           ← user's real work
  2. "minih smoke-test run"             ← 🗑️ noise
  3. "Debugging the API endpoint"       ← user's real work
  4. "minih code-review run"            ← 🗑️ noise
  5. "minih smoke-test run"             ← 🗑️ noise (ran 50 times)
```

## The Solution: Run Folder as CWD

Set the SDK's `workingDirectory` to the **run folder**. The session's `workspace.yaml` records `cwd: /my/project/agents/smoke-test/runs/2026-04-04T.../` — which doesn't match `/my/project`, so `--resume` never shows it.

```
$ cd /my/project
$ copilot --resume

  Recent sessions in /my/project:

  1. "Working on auth module"           ← user's real work
  2. "Debugging the API endpoint"       ← user's real work
  3. "Refactoring the parser"           ← user's real work
```

---

## The Three Directories

```
┌─────────────────────────────────────────────────────────────────┐
│  1. PROJECT ROOT (where minih is invoked)                       │
│     /my/project                                                 │
│                                                                 │
│     • What {{REPO_ROOT}} resolves to in the preamble            │
│     • The agent `cd`s here to do real work                      │
│     • NOT the SDK's workingDirectory                            │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  2. AGENTS DIR                                                  │
│     /my/project/agents                                          │
│                                                                 │
│     • Agent definitions + _shared/preamble.md                   │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  3. RUN DIR (SDK's workingDirectory)                            │
│     /my/project/agents/smoke-test/runs/2026-04-04T...-a1b2     │
│                                                                 │
│     • SDK records this as `cwd` in session workspace.yaml       │
│     • Session hidden from user's --resume at project root       │
│     • Frozen inputs, events.ndjson, completed.json live here    │
│     • Agent gets orientation to cd to project root first        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation (already applied)

### runner.ts

```typescript
adapter.run({
  prompt: fullPrompt,
  cwd: runDir,        // SDK CWD = run folder (session isolated)
  // config.cwd (project root) used only for {{REPO_ROOT}} replacement
});
```

### sdk-copilot.ts

Passes `cwd` through as `workingDirectory` to SDK's `createSession()`.

### Preamble orientation

```markdown
## Orientation

Your SDK session is running in the run folder. The project you're
working on is at: {{REPO_ROOT}}

Run `cd {{REPO_ROOT}}` before executing any commands against the project.
All output paths in this prompt are absolute.
```

---

## Summary

| Aspect | Design |
|--------|--------|
| Session storage | `~/.copilot/session-state/<uuid>/` (global) |
| `--resume` filtering | By `cwd` field in `workspace.yaml` |
| Isolation mechanism | SDK `workingDirectory` = run folder, not project root |
| Effect | Minih sessions don't appear in user's `--resume` at project root |
| Agent orientation | Preamble `{{REPO_ROOT}}` tells agent where real project is |
| No cleanup needed | Sessions in `~/.copilot/` are managed by SDK, not minih |
