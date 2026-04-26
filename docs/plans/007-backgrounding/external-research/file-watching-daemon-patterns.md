# External Research: Node.js File-Watching Daemon Patterns (2025–2026)

**Sources**:
- Perplexity Sonar Deep Research, 2026-04-26 (recommended chokidar v4.2)
- **Empirical refutation from chainglass project** (`~/substrate/chainglass`), 2026-04-26 (rejected chokidar entirely; uses native `fs.watch`)

**Scope**: Defers to the future eventing plan (008+), but the choices we lock in for 007 should be compatible.

---

## TL;DR — Recommended Stack (UPDATED after chainglass review)

| Component | Choice | Why |
|-----------|--------|-----|
| File watching | **Native `node:fs.watch({ recursive: true })`** with custom adapter | Chokidar v5 (and likely v4.2) opens 1 FD per file on macOS via kqueue → 25,341 FDs for 5,000 files → `spawn EBADF` on `fork()`. Chainglass team replaced chokidar with native `fs.watch` for this reason; achieved 667× FD reduction. Requires manual event normalization (see chainglass adapter pattern below). |
| Debounce | **Custom RollingWindow ~150ms (per-file)** | Matches Vite's window AND chainglass's stabilization pattern. Apply ONLY to `'change'` events; let `'rename'`/`'add'` through immediately. |
| Pattern matching | **In-callback filtering** (string substring + RegExp + function predicates) — same shape chainglass uses | No new deps. Apply after `stat()` to avoid spurious matches on deleted files. |
| Subprocess | **child_process.spawn + EventEmitter** (Perplexity advice still good) | Native; no `execa` overhead unless Windows process-tree cleanup is critical |
| Shutdown | **SIGTERM cascade, 30s grace, `detached: false`** (Perplexity advice good) | Children stay in same process group; SIGTERM cascades cleanly on Unix |
| Supervision | **Let parent supervisor handle restart** (Perplexity advice good) | Unix philosophy; daemon fails fast |
| Pidfile | **`$XDG_RUNTIME_DIR/minih/` or `~/.cache/minih/`** | XDG-compliant; falls back to platform cache dir on macOS/Windows |
| IPC | **Unix socket + TCP fallback** | Cross-platform 2025 (Windows 10+ supports Unix sockets) |

**Total dep cost**: ZERO new deps. (Down from "+chokidar +picomatch ≈ +60 deps" in original Perplexity recommendation.)

---

## ⚠️ Why We're NOT Using Chokidar (Chainglass evidence)

Chainglass (sibling project at `~/substrate/chainglass`) shipped Plan 060 "Replace Chokidar with Native File Watcher" specifically to escape the FD-exhaustion failure mode.

**The bug pattern they hit**:
- chokidar v5 dropped FSEvents support on macOS
- v5 falls back to Node's `fs.watch()` with kqueue
- kqueue opens **1 file descriptor per watched file**
- Watching `packages/` (~5,000 files) = **25,341 FDs**
- Cascade failure: 4 chainglass worktrees + Fermi + studio-agent ≈ 12,700 FDs at dev server startup
- End result: Node.js `fork()` (e.g. jest-worker in Next.js's `getStaticPaths`) fails with **`spawn EBADF`** when it can't inherit all FDs

**Verbatim from chainglass spec**: *"The Next.js dev server fails with `spawn EBADF` when the `CentralWatcherService` (Plans 023, 027, 045) watches multiple worktrees."*

**Verbatim FD measurement after fix**: *"Before: 25,341 FDs for 5,000 files (chokidar v5 + kqueue) → ~12,700 FDs across 4 worktrees. After: ~38 FDs for the same directory (native `fs.watch`) → 667× reduction."*

**Why chokidar v4.2 likely has the same problem**: chokidar v4 also dropped native bindings. Both v4 and v5 rely on Node's `fs.watch`, which uses kqueue on macOS. Perplexity didn't surface this because chokidar's README doesn't advertise the FD cost explicitly. The chainglass team measured it the hard way.

---

## Chainglass `NativeFileWatcherAdapter` Pattern (the implementation we should mirror)

Chainglass's `packages/workflow/src/adapters/native-file-watcher.adapter.ts` is the working reference. Key implementation details:

### 1. Event normalization (manual, since `fs.watch` only emits `rename`/`change`)
- `'change'` → `'change'` (with write-stabilization debounce)
- `'rename'` + stat exists + isFile → `'add'` then ALSO emit `'change'` (atomic-write quirk on macOS)
- `'rename'` + stat exists + isDirectory → `'addDir'`
- `'rename'` + stat ENOENT → `'unlink'` (no path-tracking — ENOENT is the only signal)

### 2. Write stabilization (debounce `change` events only)
- Per-file debounce timer (`Map<filePath, timeoutId>`)
- Reset timer on each event for same path
- Threshold: 200–300ms `stabilityThreshold` + 100ms poll (chainglass's tuned values; matches Perplexity's 150ms recommendation within tolerance)
- Apply ONLY to `change`. NOT to `rename`/`add` (immediate feedback for new files is expected).

### 3. Ignore-pattern filtering
- Three pattern types: string (substring match), RegExp (`.test()`), function predicates
- Applied in event callback AFTER `stat()` (so stat is called even for ignored paths — acceptable overhead)
- Filters typical noise: `node_modules`, `.git`, `dist`, `build`, `coverage`, `.next`, `.nuxt`, `.turbo`, `out`

### 4. Atomic-write quirk on macOS
From chainglass adapter source comment:
```
// On macOS, fs.watch fires 'rename' for BOTH new files AND modifications
// (because writeFile does atomic write → rename internally).
// Emit both 'add' and 'change' — consumers register for specific events,
// and debounce layers absorb the duplicate.
```

### 5. Root-level `change` filter
Filters out `fs.watch` firing `change` on the watched directory itself (rather than contents):
```js
if (eventType === 'change' && !filename.includes('/') && !filename.includes('\\')) {
  const watchedBasename = resolved.split('/').pop() || '';
  if (filename === watchedBasename) return; // Skip parent-dir 'change'
}
```

### 6. Error pipeline
- FSWatcher errors → `'error'` events
- `stat()` ENOENT errors → treated as `unlink`
- Callback exceptions silently caught to prevent one bad listener from killing the pipeline

---

## Linux-Specific Caveat: inotify Limit

Default `/proc/sys/fs/inotify/max_user_watches` = **8,192 watches per user**. Chainglass documented the workaround:

```bash
echo 65536 | sudo tee /proc/sys/fs/inotify/max_user_watches
```

We should document the same in any minih daemon docs that target Linux.

---

## What Still Stands From the Perplexity Research

- **Subprocess management**: `child_process.spawn` + EventEmitter pattern (don't `await` spawn; track running runs in a `Map`).
- **Shutdown**: SIGTERM cascade, `detached: false`, 30s grace period for agents, 5s for watcher.
- **Windows caveat**: SIGTERM = `TerminateProcess()` (hard kill); send graceful shutdown via stdin JSON before SIGKILL.
- **Supervision**: Let parent (npm scripts / systemd / PM2) handle restart. Don't build internal restart logic.
- **Pidfile location**: XDG_RUNTIME_DIR (Linux) → `~/Library/Caches/minih/` (macOS) → `%LOCALAPPDATA%\\minih\\` (Windows) → `~/.cache/minih/` (fallback).
- **`start`/`stop`/`status`**: separate CLI invocations. `start` spawns detached child. `stop` reads pidfile + `process.kill(pid, 'SIGTERM')`. `status` does `process.kill(pid, 0)` (existence test).
- **IPC**: Unix socket + TCP fallback (Windows 10+ supports Unix sockets).
- **Testing**: vitest fake timers for debounce (`vi.useFakeTimers(); ... ; vi.advanceTimersByTime(150);`). Mock the watcher with `EventEmitter`. For real-file tests: tmpdir + `waitForEvent` helper. Set `pool: 'single'` to avoid Windows dir-lock issues.

---

## Implications for Plan 007 (prerequisite work)

We're NOT building the daemon in this plan. Confirmed direction:

- **Inbox/state file conventions** must be filesystem-readable from outside the agent's process. Future daemon needs to write inbox messages and read state without going through the SDK. ✓ (already aligned in dossier).
- **Run-folder layout** should expose paths the daemon can `fs.watch()` later. ✓.
- **MCP server lifecycle**: confirmed via empirical test (`mcp-leak-validation.md`) that minih's existing `client.stop()` pattern correctly reaps the bundled CLI + spawned MCP servers. Spawn pattern for our inside-channel MCP server should mirror this.

---

## Implications for the eventing plan (008+, deferred)

- **Use native `fs.watch({ recursive: true })`** + a custom adapter modeled on chainglass's `NativeFileWatcherAdapter`. Zero new deps.
- **Implement event normalization** (rename↔add/unlink/addDir/unlinkDir, atomic-write duplicate handling) in the adapter — ~150 LOC per chainglass.
- **Per-file debounce** ~150–300ms for `change` events; pass through `rename`/`add` immediately.
- **In-callback ignore filtering** — string + RegExp + function predicates.
- **Document Linux inotify limit + workaround**.
- Pidfile + IPC socket conventions documented above.
- Don't build supervisor-in-daemon; let users wrap with npm scripts.
- 150 ms debounce default; tunable via flag.
- `infiniteSessions: true` for the inside agent (per `sdk-session-ttl.md`).

---

## Bottom Line

Perplexity's chokidar v4.2 recommendation is overruled by **direct empirical evidence from chainglass** that hit FD exhaustion. The chainglass team paid the cost of writing a 150-LOC native adapter and got 667× FD reduction, no new deps, and shipped to production. We should use the same approach for the future eventing plan.

**Cited sources**:
- chainglass Plan 060 "Replace Chokidar with Native File Watcher" (status: Landed)
- `~/substrate/chainglass/packages/workflow/src/adapters/native-file-watcher.adapter.ts`
- chainglass Plan 059 (root-cause documentation: 25,341 FDs measurement, `spawn EBADF`)
- Original Perplexity research (still valid for subprocess, shutdown, supervision, pidfile, IPC, testing — only the watcher choice is overruled)
