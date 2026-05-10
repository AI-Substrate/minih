# Workshop: `minih attach` — cross-process read+write TUI for any running agent

**Type**: CLI Flow + API Contract + Integration Pattern
**Plan**: 016-a2a-companion-protocol
**Spec**: (no formal spec — replaces MW12; subsumes FX001)
**Created**: 2026-05-02
**Status**: Draft

**Related Documents**:
- `../companion-experience-plan.md` § Deferred follow-ups (MW12)
- `../fixes/FX001-tui-input-routes-to-inbox.md` (**superseded by this workshop** — FX001's input-bridge dual-routing was scoped only to `run --human` boot; the code change applies equally to cross-process attach. Folded into the fix dossier for this workshop.)
- `../../../how/companion-mode.md` (Power-On-Mode protocol; companions are the canonical attach target but not the only one)
- `src/cli/commands/view.ts` (the existing read-only attach; basis for `attach`)
- `src/cli/commands/run.ts` (the existing in-process `--human` mount; the experience to mirror)
- `src/cli/human/input-bridge.ts` (the dual-routing seam — needs to gain cross-process write capability)

**Domain Context**:
- **Primary**: `cli` (`src/cli/commands/attach.ts` NEW; `src/cli/commands/view.ts` existing; `src/cli/human/input-bridge.ts` extension)
- **Related**: `runner` (`onSessionReady` ctx forwarding; lane-write helpers already public via `cli/coordination.ts:appendInboxMessage`); agent prompts (no change — the agent never knows or cares whether input came from same-process or attach)

---

## Purpose

The user (and any human operator) should be able to **drop into a live agent run** at any time, follow what it's doing, type messages to it, then leave — without affecting the agent's lifecycle. Today's `minih view` is read-only; the AI starts companions (or any agent) in background, and the human in another terminal has no way to chime in without flipping to a separate `outside inbox send` shell that doesn't show the live transcript.

**The contract**: `minih attach <slug>` produces an experience **byte-equivalent** to `minih run --human <slug>` from the operator's perspective, except:
- It attaches to an existing run (the AI's, or anyone else's) rather than booting a new one.
- Ctrl-C / Ctrl-D detaches but never stops the agent.
- It works for **any agent**, not just `code-review-companion` — companions are common but not the only use case (per user: *"there's gonna be a heap of them"*).

This workshop designs the command, the input-routing seams, the lifecycle ownership rules, the failure modes, and explicitly subsumes FX001.

## Key Questions Addressed

- What's the right command name and surface? (`attach` vs extending `view --writable`)
- How does Ctrl-C **detach without stopping** the agent? (multi-attach safety)
- How does the input bridge route footer text cross-process? (the seam FX001 was designing)
- What's the experience for non-coordinated agents (no inbox)? Read-only fallback?
- Multi-attach: can two operators attach simultaneously?
- How does `attach` interact with `--human` (boot-time TUI)? Same code, different entry?
- What state is owned by the run, what's owned by each attach session?

---

## 1. The user's stated contract (verbatim)

> *"I will want to be able to drop in, see how things are going, then go away again. So remember pressing control C on the viewer doesn't stop the agent or anything like that. But it should be exactly the same experience if I had run it myself with human mode."*

Three load-bearing constraints:

1. **Drop-in / drop-out repeatedly**. Multiple attach sessions over the lifetime of one run. Maybe overlapping with each other (user attaches; AI attaches; both attached at once).
2. **Ctrl-C is detach, not kill**. The agent's lifecycle is owned by `minih run`, not by any `attach` session. Killing the run requires `outside inbox send --type control --body 'stop'` or `kill <pid>` — never via the TUI.
3. **Byte-equivalent experience to `--human`**. Same TUI, same panes, same keybindings, same input-routing. The user shouldn't have to learn a different mental model when attaching versus booting.

These three together drive every design decision below.

---

## 2. Command shape

### 2.1 Surface

```
minih attach <slug>
  [--run <runId>]            # explicit run id; default: latest-active (E170 if ambiguous)
  [--read-only]              # opt-in read-only attach (skip input wiring even if writable)
  [--agents-dir <dir>]
```

**No `--human` flag** — `attach` IS the human-mode TUI by definition. (And we file MW10's symmetric-flag fix to make `view --human` a no-op alias for muscle memory.)

### 2.2 Why a new command rather than extending `view`?

Considered:
- **`view --writable`**: cleanest reuse but conflates two different intents. `view` is "read-only inspector"; the writable case has different lifecycle semantics (input bridge wiring, optional ack feedback) and warrants a distinct verb.
- **`attach` (chosen)**: dedicated verb mirroring `tmux attach` / `docker attach` semantics; clear separation from `view` (read-only) and `run` (boot). The terms are well-known.
- **`watch`**: too overloaded with `tail --watch`-style semantics in the wider Unix world.
- **Extend `run --attach`**: confusing — `run` boots; `--attach` would invert that. Don't muddle.

**Decision**: `minih attach <slug>` as a new top-level command. `view` stays for read-only inspection (still useful for completed runs, snapshot mode in the future). We may eventually deprecate `view` in favour of `attach --read-only`, but that's out of scope.

### 2.3 What `attach` does NOT do

- **Does NOT boot the agent** — that's `run`'s job.
- **Does NOT take over the SDK session** — that's `resume`'s job.
- **Does NOT write to the SDK conversation channel** — input routes to the coordinated inbox, NOT to the SDK conversation. (Differs from `run --human` for non-coordinated agents — see § 5.)
- **Does NOT have any side effects on detach** — closing the TUI is purely operator-side; the run continues.

---

## 3. Lifecycle and exit contract

### 3.1 The exit matrix

| Action | Effect on TUI | Effect on agent run |
|---|---|---|
| Ctrl-C in attach | Detach; exit 130 | None — agent keeps running |
| Ctrl-D in attach | Detach; exit 0 | None |
| SIGTERM to attach process | Detach; exit 143 | None |
| Run completes (status: completed/failed) while attached | TUI shows terminal frame for 5s, then auto-exits | (Run already done) |
| Run process killed externally | Liveness watcher detects PID gone; TUI shows "agent terminated"; auto-exit 5s later | (Run was killed by other means) |
| User sends `control:stop` from attach footer | Message appended to outside inbox; agent gracefully shuts down per its own loop | Agent eventually exits |

**The hard rule**: attach's exit path NEVER calls `process.kill()` or any signal-to-run path. It only ever tears down its own watchers, restores terminal cursor, and exits its own process.

### 3.2 What the existing `view.ts` already gets right (and we'll preserve)

- Single shared `exitState` guard across SIGINT / SIGTERM / Ctrl-C in TUI / completed-run auto-exit (lines 111-122).
- `setImmediate(process.exit)` lets Ink's cursor restore + raw-mode reset land before the process dies.
- Completed-run auto-exit timer with `process.stdin.once('data')` for early dismissal.
- `MultipleActiveRunsError` propagation (the dogfood rule's E170 behaviour).

`attach` reuses this exact exit path verbatim — it's already correct for read-only and stays correct for read+write.

### 3.3 Multi-attach safety

> *"there's gonna be a heap of them"* — companions, smoke tests, long-running validators, demo agents. Multiple operators may attach to the same run.

**Fully supported by construction**, because:
- The run feed (`createRunFeed`) is filesystem-watch-driven; N readers are independent.
- The inbox lane is append-only on disk; N writers are safe (atomic appends; no shared locks needed).
- The SDK session is owned by `run`, not by any attach process.
- State is read-only via the lane (we never write state from attach — peer-state changes go through `outside state set` if needed; not in scope here).

**Risk**: two operators typing simultaneously could both append messages within milliseconds. Both land; the agent sees both in arrival order. That's correct semantics — same as if two people were sending `outside inbox send` simultaneously. No coordination needed.

**Visible-side effect**: Phase 2 of plan 009's workbench renders inbox messages in chronological order regardless of who sent them. So Operator B's message arrives interleaved with A's in everyone's transcript pane. That's the intended behaviour.

---

## 4. Input bridge — the FX001 work, generalised

### 4.1 What FX001 was scoped to

`run --human` boot-time. The input bridge gets a `SessionSender` from the in-process SDK adapter and routes typed text to the SDK conversation. FX001 added a coordination-aware fork: for coordinated agents, route to `appendInboxMessage` instead of `sender.send()`.

### 4.2 What changes for `attach`

`attach` is **cross-process** — there is no `SessionSender` available because the SDK session lives in the `minih run` process, not in this one. So:

- **For coordinated agents**: same as FX001's coordinated path. Footer input → `appendInboxMessage` writes to the outside inbox file. The agent's inbox forwarder picks it up and delivers to the SDK conversation. **This is the primary case.**
- **For non-coordinated agents**: there's no inbox lane. There's no peer to write to. **Footer input must be read-only** in this case — capability `'input read-only — non-coordinated agent'`. The TUI footer label communicates this clearly.

### 4.3 Refactored `InputBridge` contract

Picking up from FX001's design and extending for cross-process:

```ts
export interface InputBridgeInput {
  /** Run dir — needed to locate the outside inbox file. */
  runDir: string;
  /** Agent slug — needed for command-name traceability in envelopes. */
  agentSlug: string;
  /** True when this view is attached cross-process (via `attach`/`view`). */
  attached: boolean;
  /** Coordination flag from the agent's frontmatter. */
  coordinated: boolean;
  /** Current run status from the manifest. */
  runStatus: LiveRunStatus;
  /** SDK sender — only present for in-process `run --human`; null for attach. */
  sender?: SessionSender;
}

export type InputCapability =
  | 'input → inbox'                 // coordinated; writes to outside inbox lane
  | 'input → session'                // non-coordinated; writes to SDK conversation (run --human only)
  | 'input read-only — non-coordinated' // attach to a non-coordinated agent
  | 'input read-only — completed'    // run is in terminal state
  | 'completed';                     // legacy alias preserved for callers
```

### 4.4 Capability resolution table

| Context | `attached` | `coordinated` | `sender` | `runStatus` | Resulting capability |
|---|---|---|---|---|---|
| `run --human` non-coord | false | false | present | active | `input → session` |
| `run --human` coord | false | true | present | active | `input → inbox` |
| `attach` coord | true | true | absent | active | `input → inbox` |
| `attach` non-coord | true | false | absent | active | `input read-only — non-coordinated` |
| Any | * | * | * | completed/failed | `input read-only — completed` |

The `'input → inbox'` rows are identical regardless of `attached` — that's the whole point. The agent never knows which process the message came from.

### 4.5 The cross-process write path (concrete)

```ts
// Inside InputBridge.submit() when capability is 'input → inbox':
async submit(text: string): Promise<InputSubmitResult> {
  const message = buildOutsideMessage({
    type: 'task',           // default — see § 4.6
    subject: synthesiseSubject(text),
    body: text,
  });
  try {
    appendInboxMessage(
      'attach.input',       // commandName for traceability in any error envelope
      { runDir },           // CoordinationRunLocation; build from runDir
      'outside',
      message,
    );
    return { ok: true, messageId: message.id };
  } catch (err) {
    return { ok: false, reason: `inbox write failed: ${(err as Error).message}` };
  }
}
```

`appendInboxMessage` is already cli-domain (`src/cli/coordination.ts:92`) — no boundary issues. The same call site `outside inbox send` uses, with the same atomic append semantics. **This is exactly the FX001 design lifted up to also support the attach context**; we only have to write the routing once.

### 4.6 Default message type and subject synthesis

- **Default `type: 'task'`**. Most operator footer typing is "do this thing" — task is the natural verb. Operators wanting other types use `outside inbox send` with `--type` (still available; not deprecated).
- **Subject synthesis**: first 60 chars of the body, truncated at the last word boundary. If body is multi-line, take the first line.
- **No `ackOf` threading by default**. The footer is for new tasks, not threading. (A future enhancement could add Tab-completion for `ackOf <last-message-id>` but that's out of scope.)

### 4.7 What this is NOT

- Not a multi-line composer (today). Footer is single-line; Enter sends. Multi-line authoring goes via `outside inbox send` until a future enhancement.
- Not a typed-command parser (no `/stop`, `/state`, `/help` slash commands). Footer is plain text → inbox message body. Slash-commands could be a future enhancement; out of scope here.
- Not a state writer. Footer never writes coordination state. State changes go via `outside state set`.

---

## 5. Read-only fallback for non-coordinated agents

For agents WITHOUT `coordination: enabled`, there is no outside inbox lane. The bridge must refuse writes cleanly and the footer must communicate why.

**Footer label** in this case: `[ input read-only — agent is not coordination-enabled. Use 'minih run' to drive a non-coordinated agent. ]`

**What the user sees**:
- The TUI mounts and shows the run's transcript / state (state will be sparse — no `state/*.json` for non-coordinated runs).
- Typing in the footer either does nothing or shows a one-line error toast: "agent is not coordination-enabled; cannot send input".
- All the read-only goodness (transcript, workbench rendering, exit handling) still works.

**Why we don't reject this case**: even non-coordinated runs benefit from being viewable. A long-running smoke test or one-shot agent can be observed via `attach --read-only` (or implicit read-only fallback) without needing two terminals.

---

## 6. The user flow (worked example)

### Scenario
The AI has booted a `code-review-companion` in background:
```
[Terminal A — AI's shell, headless]
$ export GH_TOKEN=$(gh auth token)
$ minih run code-review-companion &
[1] 12345
$ RUN=$(minih status code-review-companion 2>/dev/null | jq -r '.data.runId')
$ minih outside inbox send code-review-companion --run "$RUN" --type briefing ...
```

### Human drops in
```
[Terminal B — human's shell, separate window]
$ minih attach code-review-companion
```

If only one active run: TUI mounts immediately. If multiple active runs (the MW11 stale-active problem): E170 with the candidate list; user picks one with `--run <id>`.

### What the human sees
- **Header pane**: agent slug, run id, model, status pill (`active`).
- **Transcript pane**: full backlog from the briefing onwards, scrollable with arrow keys / PageUp / PageDown / Shift-G.
- **Workbench pane**: state timeline (both lanes), inbox event list with ⇄ correlation arrows.
- **Footer**: input field with capability label `[ input → inbox ]` and the same Ctrl-C-to-exit hint as `run --human`.
- **Live updates**: as the AI sends new commit-boundary review-requests, they appear in real-time. As the companion replies with findings, they appear in real-time.

### Human chimes in
```
> hey, please also flag any unused imports in commit a5ce5d9
[ Enter sends — appears in transcript as outside.task with subject "hey, please also flag any unused imports in commi...", from operator ]
```

The companion's `wait_for_any` wakes (post-FX007 — including pre-existing if it was in a poll gap), processes the new task, replies. Both AI and human see the reply.

### Human leaves
```
^C
[detached at <runId> — agent continues. To re-attach: minih attach code-review-companion --run <runId>]
$
```

The agent process keeps running. The AI's review-request pings continue to land. The human can re-attach later — same command, same TUI, full backlog still available.

---

## 7. Failure modes and operator messaging

| Failure | Detection | TUI message | Exit code |
|---|---|---|---|
| Run not found (slug invalid) | `resolveRun` returns null | "no runs found for <slug>" stderr (no TUI) | 1 |
| Multiple active runs | `MultipleActiveRunsError` | E170 envelope on stderr listing candidates | 1 |
| Run already completed | `runStatus === 'completed'` | TUI mounts in read-only mode; 5s auto-exit on input | 0 |
| Run dies during attach | Liveness watcher (existing) | "agent terminated (run.json status: failed)"; 5s auto-exit | 0 |
| Agent not coordination-enabled | Frontmatter parse | TUI mounts; footer shows `read-only — non-coordinated`; transcript still works | n/a |
| Inbox write fails (disk full, permissions) | `appendInboxMessage` throws | One-line toast in footer: "send failed: <reason>"; footer remains writable for retry | n/a (no exit) |
| Stale-active manifest (MW11) | PID liveness check fails | "candidate run <id> is stale (pid <pid> dead) — skipping"; resolve continues | (depends on whether other active runs remain) |

The "send failed" footer toast is the only one that doesn't have an existing `view.ts` analogue (because `view` doesn't write). New error UX; design lightly — single-line Ink rerender, no modal.

---

## 8. Re-attach state and backlog

### 8.1 Question

When a human re-attaches to a run that's been alive for an hour, do they see the full backlog or only events from now on?

### 8.2 Resolution: full backlog

The TUI mounts via `feed.readSnapshot()` (existing — `view.ts:95`) which builds the full `HumanViewModel` from on-disk artifacts. So:
- Every transcript message ever sent is replayable.
- Every state transition is visible in the workbench timeline.
- Every inbox round-trip with `ackOf` correlation is rendered.

The new attach gets exactly the same first frame as if they'd been there from boot. The only difference is *when* they showed up.

### 8.3 Question

What if the backlog is huge (long-running run, MB of NDJSON)?

### 8.4 Resolution: existing `maxRows` cap

Per memory: `DEFAULT_MAX_ROWS = 30` for transcript pane. Older rows are paged out — the model holds them but the renderer windows them. Fine for v1. A `--from <iso>` flag could let attaching operators trim the model up front; out of scope here.

---

## 9. Implementation sketch

### 9.1 New file: `src/cli/commands/attach.ts`

Mostly a copy-paste of `view.ts`'s structure (resolver, feed, mount, exit handling) with three diffs:

1. Build the `InputBridge` with the new contract (`runDir`, `agentSlug`, `coordinated`, `attached: true`, `sender: undefined`).
2. Compute `coordinated` from `parseFrontmatter(prompt.md).coordination?.enabled === true` — the agent dir is known once the run resolves.
3. Footer label and exit message reflect attach semantics ("detached" rather than "exited").

Estimated diff: ~50 added lines of `attach.ts` plus shared refactoring with `view.ts`. Likely some helper extraction (`mountAttachedTui()` shared between `view` and `attach`).

### 9.2 `src/cli/human/input-bridge.ts` extension

Per FX001 + § 4.3 above. The bridge gets the new fields, the new capability enum, and the cross-process `appendInboxMessage` write path. Tests at `test/cli/human-input-bridge.test.ts` add cases for each capability row in § 4.4.

### 9.3 `src/cli/commands/view.ts` updates

Migrate `view.ts` to the new `InputBridgeInput` shape. Capability remains `'input read-only — completed'` (or terminal equivalent) for `view` — the existing read-only behaviour is preserved.

### 9.4 Help / discoverability

- `minih --help` adds an `attach` row in the command list.
- `minih attach --help` includes a one-paragraph "Ctrl-C detaches without stopping the agent" reminder.
- The `--human` footer mentions "use `minih attach <slug>` from another terminal to follow along + chime in".
- Docs how-to (`docs/how/driving-an-agent-from-outside.md` from FX003) gets a section on attach.

---

## 10. Subsumes FX001

`FX001-tui-input-routes-to-inbox.md` was scoped to `run --human` boot-time only. The input-bridge change it described (dual-routing on coordination flag) is the EXACT change needed for `attach`, just hooked up in two contexts instead of one.

**Action**: when this workshop's fix dossier is written, FX001's tasks fold in as the in-process leg of the same change. FX001's dossier file gets a `**Status: SUPERSEDED by FX###-attach**` header pointing here. No work is lost; the union is one fix dossier instead of two with overlapping code.

---

## 11. Open questions

### Q1: Should `attach` warn before exit if there are unsent characters in the footer?

**OPEN**: probably yes (single-line toast: "you have unsent input — Ctrl-C again to confirm detach"). Low priority for v1; current Ctrl-C just exits.

### Q2: Should `attach` show who else is currently attached?

**RESOLVED for v1**: no. There's no canonical "list of attaches" today; we'd have to add one. Out of scope. A future workshop could add a `<run>/.attaches/` directory of pid files for `minih attaches <slug>` to list, but defer.

### Q3: Should the footer support `/stop` to send `control:stop`?

**OPEN — defer**: nice-to-have, but slash-commands are a slippery slope (what about `/state`, `/inspect`, `/help`?). v1 keeps the footer plain-text-to-inbox. If operator wants to stop, `outside inbox send --type control` from another shell is fine, AND filing a workshop for slash-commands as a follow-up is the right call.

### Q4: How does `minih attach` interact with `minih view`?

**RESOLVED**: they coexist. `view` is read-only and stays useful for completed runs / snapshot inspection / historical exploration. `attach` is the live read+write peer. Neither deprecates the other. (Long-term, `view` could be implemented as `attach --read-only` for cohesion, but that's a refactor not a contract change.)

### Q5: Should `attach` for a non-coordinated agent error out, or fall back to read-only?

**RESOLVED**: fall back to read-only (with clear footer label). Erroring would mean operators have to remember which agents are coordinated before attaching, which is bad UX. Read-only fallback always works; users learn the affordance from the footer.

### Q6: What happens if the operator types when capability is read-only?

**RESOLVED**: input field accepts the keystrokes (so the operator can compose), but Enter shows a single-line toast "send disabled — read-only mode. To send, use `minih outside inbox send` (coordinated agents only)" and clears the input. The toast disappears on next keystroke.

### Q7: Does `attach` need a `--no-input` flag for operators who want to definitely-not-write even though they could?

**RESOLVED**: yes, that's `--read-only`. Same flag name as the equivalent on `view` (or future view alias). Preserves muscle memory.

### Q8: Multi-attach race — two operators type the same character within the same Ink tick. Do we coalesce?

**RESOLVED**: no coalescing. Each `attach` is its own process with its own footer. Each Enter press appends one message. They land in arrival order on disk. Race-free by file-append atomicity.

### Q9: Should `attach` work for non-active runs (e.g. for time-travel inspection)?

**RESOLVED for v1**: no — that's `view`'s job. `attach`'s value proposition is the live write path. For completed runs it falls back to read-only with the auto-exit timer (see § 7), which is functionally equivalent to `view`. No need to pretend attach is a time machine.

---

## 12. Migration plan (single fix dossier)

One fix dossier covers this whole workshop because the tasks are tightly coupled and ordering matters:

| Order | Task class | Notes |
|---|---|---|
| 1 | Refactor `InputBridge` contract per § 4.3 | Adds new fields; widens capability enum; tests for each capability row |
| 2 | Implement coordinated write path in submit() | The FX001 in-process leg + the cross-process leg, both using `appendInboxMessage` |
| 3 | Migrate `run.ts` to new `InputBridge` shape | Forward `runDir`/`agentSlug`/`coordinated` from `onSessionReady` ctx |
| 4 | Migrate `view.ts` to new shape (read-only) | Capability stays `'input read-only — completed'` or `'input read-only — non-coordinated'` |
| 5 | New `src/cli/commands/attach.ts` | Mostly a clone of `view.ts` with the new bridge wiring |
| 6 | Help text updates | `--help` rows; in-flag descriptions; docs cross-references |
| 7 | Tests: capability table coverage | Each row in § 4.4 gets a test |
| 8 | Tests: e2e attach scenario | Boot a smoke-test agent, attach, send a message, verify it lands on the inbox |
| 9 | Mark FX001 as SUPERSEDED | One-line header + cross-reference to the new dossier |
| 10 | Docs | AGENTS.md companion-mode section gains `minih attach` mention; FX003's how-to gets attach section |

## 13. Out of scope for this workshop

- **Slash commands** (`/stop`, `/state`, `/help`) — Q3, future workshop.
- **Multi-line composer** — § 4.7, future enhancement.
- **Slash-attach to other agents from within the TUI** — way out of scope.
- **State writes from attach** — § 4.7. State changes go via `outside state set` only.
- **Time-travel / `--from <iso>`** — § 8.4, future enhancement.
- **Multi-attach visibility** (`minih attaches <slug>` to list) — Q2, future workshop.
- **Clusters 002 / 003 / 004** — orthogonal magicWand groups, separate workshops.

---

**Implementation note**: this workshop produces no code. It defines a single fix dossier (FX015 — `minih attach` + input-bridge cross-process write, subsuming FX001). Companion validation should run after dossier write per `/validate-v2`. File the dossier via `/plan-5 --fix` when the user approves.
