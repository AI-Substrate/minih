# Draft closing comment for issue #44 (post at merge, with Jordan's go)

> Drafted by plan 026 T009. Corrects the earlier triage comment's claim that
> no `--timeout` existed (CD-06) and summarizes the shipped fix.

---

Fixed by plan 026 (stall watchdog + run budgets).

First, a correction to my earlier triage comment: minih **did** already have `--timeout` (default 900s on `run`) — "no --timeout/--max-turns flags exist today" was wrong about the first half. The real mechanism behind this issue was nastier: the timeout *fired*, but its cleanup path awaited unbounded JSON-RPC calls (`abort`/`destroy`/`disconnect`) into the hung Copilot CLI subprocess. When the subprocess was wedged mid-`assistant.streaming_delta`, those awaits hung forever and blocked every terminal write — which is exactly why `run.json` stayed `active` with no `completed.json`. There was also no inactivity detection at all: the run's completion contract was "wait for `session.idle` or `session.error`", and a silently-dying stream delivers neither.

What shipped:

- **Inactivity watchdog**: any provider event resets it; if the stream goes silent for the stall window the run terminalizes itself — `run.json` `status: 'failed'` + `terminalReason: 'stalled-stream'`, a synthetic `run_stalled` event in `events.ndjson`, `completed.json` (`result: 'failed'`), exit 124. `--stall-timeout <seconds>` on `run` + `resume` (default 300, `0` disables).
- **`--max-turns <count>`**: turn budget (consolidated assistant messages; chunking/tools/thinking don't count), `terminalReason: 'max-turns'`.
- **Bounded cleanup + force-stop escalation**: every SDK cleanup await between a kill trigger and the terminal writes is now deadline-bounded (~5s per rung), and a hung/failed rung escalates to `client.forceStop()` (SIGKILL on the CLI subprocess). Terminal artifacts no longer depend on the SDK cooperating — the forever-`active` corpse this issue describes can't happen for any of the three triggers.
- The existing wall-clock timeout now records `terminalReason: 'timeout'`, effective budgets land in `run.json` `budgets: {…}`, `minih status` prints a `Reason:` line, and `run`/`resume` share one frontmatter-aware 900s default (resume's hardcoded 300s is gone).
- SDK bumped to `@github/copilot-sdk@1.0.1`.

Docs: README § Run budgets and `docs/how/run-liveness.md` § Run budgets. Windows-specific detached behavior (copilot-cli#2525's shape) remains untested on Windows — the watchdog logic itself is platform-neutral.
