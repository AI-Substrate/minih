
## 2026-04-29T08:55:16.925Z — code-review-companion / 2026-04-29T18-22-45-108Z-b488

- runId: 2026-04-29T18-22-45-108Z-b488
- runDir: /Users/jordanknight/substrate/minih/agents/code-review-companion/runs/2026-04-29T18-22-45-108Z-b488
- summary: Reviewed all 8 tasks (T000-T007) of plan 012 (peer-activity-telemetry) during a Power On Mode coordinated session. The plan adds ground-truth peer activity telemetry to minih's outside-lane CLI commands, surfacing a single-word verdict (listening/between-polls/deaf/silent/dead/n/a/unknown) derived from events.ndjson tool-call telemetry rather than self-reported state. Caught 3 findings across 9 review cycles: F001 (MEDIUM, undefined/null boundary concern — mitigated in T002), F002 (HIGH, lastAckOf reading wrong field name messageId vs msgId — fixed in T007), F003 (MEDIUM, doctor deaf check unreachable + dead verdict not surfaced — fixed in T007). All tasks approved. Final test count: 605 passed, 10 skipped, 0 vulnerabilities. The plan's core deliverable — making agent communication failure modes visible at send-time instead of at timeout — is verified end-to-end via a live smoke test against this very companion session.
- **magicWand** (target: coordination): inbox_list should support waitForAny: ['*'] as a wildcard meaning 'any outside message of any type'. Right now I have to enumerate every possible type in my filter array (['task','question','directive','control','briefing','review-request',...]) and manually widen it when new types are invented. A wildcard would make companions future-proof without prompt edits. This is the root cause of the deafness bug that motivated plan 012 in the first place — if I could just say 'wake me for anything from outside', the filter-mismatch class of bugs disappears entirely.
- difficulties:
  - [annoying] knowledge: No way to discover my own idle budget. The coordination loop says 'if elapsed_since_last_outside_message > input.idleBudgetMs: goto FAREWELL' but idleBudgetMs is not surfaced as an env var or state field. I had to just keep polling and hope. (workaround: Kept polling indefinitely; relied on outside peer to send a stop signal)
  - [degrading] coordination: waitForAny filter requires explicit enumeration of all message types. No wildcard support. Adding a new outside message type (like 'briefing' or 'review-request') requires updating every companion's prompt AND instructing running sessions to manually widen their filter. (workaround: Manually widened filter per implementor's briefing instructions)

## 2026-04-29T11:17:07.485Z — code-review-companion / 2026-04-29T21-01-20-922Z-b83b

- runId: 2026-04-29T21-01-20-922Z-b83b
- runDir: /Users/jordanknight/substrate/minih/agents/code-review-companion/runs/2026-04-29T21-01-20-922Z-b83b
- summary: Reviewed plan 013 (message-reply-chains) across 4 commit batches (402fca4..512cee3). Plan promotes the existing ackOf field from ack-only correlation to a general parent pointer for reply chains. Reviewed: T001+T007 (CLI gate removal + integration tests), T002+T008 (forwarder label switch + unit tests), T003+T004+T009 (snapshot sweep no-op + MCP description rewrite + round-trip test), T005+T006 (preamble x3 + AGENTS_README docs), T010+T011+T012 (regression sweep + domain history rows + fft gate). Full drift sweep confirmed zero stale references in source/test files, preamble files byte-identical, domain history rows present in all 3 domains. Verdict: APPROVE. Zero findings — the implementation is clean, backward compatible, and drift-free.
- **magicWand** (target: coordination): Add a default idleBudgetMs to the code-review-companion's input schema (e.g., 120000ms = 2 minutes) so the companion doesn't have to guess when the drain phase is over. The orchestrator could override it in the briefing, but having a sane default would eliminate the arbitrary '5 long-polls' heuristic I used.
- difficulties:
  - [annoying] config: No input.idleBudgetMs in run config — companion had to guess when drain phase was over using arbitrary 5-poll heuristic (workaround: Used 5 consecutive empty 30s long-polls (≈150s) as a proxy for idle budget expiry)
  - [annoying] config: MINIH_PROJECT_ROOT env var not available in shell session — had to derive project root from run folder path in the preamble (workaround: Used the literal path from the prompt (/Users/jordanknight/substrate/minih))

## 2026-04-30T02:07:22.064Z — code-review-companion / 2026-04-30T11-29-56-399Z-5860

- runId: 2026-04-30T11-29-56-399Z-5860
- runDir: /Users/jordanknight/substrate/minih/agents/code-review-companion/runs/2026-04-30T11-29-56-399Z-5860
- summary: Reviewed plan 014 (wait_for_any unified event-wait primitive) across 3 commit boundaries spanning T001-T015. The implementation is solid: settlement-race cleanup correctly tears down all watchers on every path (event-fire, timeout, registration-error), the self-write filter correctly suppresses the agent's own state writes via updatedBy check, documentation is in sync across preamble x3 + AGENTS_README + smoke-test, and the MCP error mapping chain (StateFileCorruptError → MCP_STATE_CORRUPT) is complete. Two findings issued: F001 (LOW) for undocumented JSON.stringify assumption in statesEqual, F002 (MEDIUM) for missing error/registration-failure cleanup tests. Both were addressed by the orchestrator in a follow-up commit. Final fft: 649 tests green, 0 vulnerabilities.
- **magicWand** (target: coordination): The coordination loop would benefit from a 'drain-phase heartbeat' — when the orchestrator signals plan-complete and enters drain mode, a brief automatic 'control: drain' message (distinct from 'stop') would let the companion know to wrap up open findings and prepare the farewell, rather than the current pattern of idle-polling for ~10 minutes before the stop arrives. This would reduce idle token spend significantly in Power On Mode sessions.

## 2026-04-30T04:01:11.016Z — code-review-companion / 2026-04-30T13-46-38-887Z-5381

- runId: 2026-04-30T13-46-38-887Z-5381
- runDir: /Users/jordanknight/substrate/minih/agents/code-review-companion/runs/2026-04-30T13-46-38-887Z-5381
- summary: Code review companion session for plan 015 (agent-readme command). Two review batches processed: (1) T001-T004 — command code path, E160 allocation, SIGPIPE handler, bundle copy, help signposting; (2) T005-T008 — README companion section expansion, test coverage (13 tests), domain history row, plus F001 fix commit. Both batches APPROVED. One LOW finding (comment/code mismatch on path-resolution count) was issued and fixed in a follow-up commit (1f79435). Verified independently: path resolution math is correct (two `..` from dirname lands at dist/AGENTS_README.md); README expansion touches only the two prescribed regions (old H3 removal + new H2 insertion); no verbatim paste from docs/how/companion-mode.md; cross-link anchors (#reply-chains, #wait-for-any-plan-014) exist; AC-18 (package.json immutability) satisfied. Clean implementation throughout.
- **magicWand** (target: coordination): Add an optional `idleHeartbeat` field to the briefing message that tells the companion how often to emit a progress pulse during idle periods — currently the outside operator has no signal that the companion is alive between tasks other than inferring from state. A periodic 'still listening' heartbeat (e.g., every 2 minutes) would give the human-view workbench a timeline of liveness without cluttering the inbox with meaningful content.

## 2026-04-30T09:12:31.785Z — code-review-companion / 2026-04-30T18-42-34-006Z-4110

- runId: 2026-04-30T18-42-34-006Z-4110
- runDir: /Users/jordanknight/substrate/minih/agents/code-review-companion/runs/2026-04-30T18-42-34-006Z-4110
- summary: Code-review companion booted, oriented on plans 009 (Human Agent View Phase 2, TUI polish in progress on branch 007-backgrounding) and 015 (agent-readme command, DRAFT with 8 tasks). Long-polled for outside messages for the full 30-minute idle budget window. No tasks, questions, directives, or control messages were received. Zero findings produced. Exiting cleanly on idle-budget expiry.
- **magicWand** (target: minih): A server-side idle budget enforcer in the minih runner that terminates the run after idleBudgetMs of no outside inbox activity, rather than relying on the agent to self-police its own idle clock. This would prevent wasted LLM tokens on long-poll cycles when no orchestrator is actively engaged. The runner already knows when the last outside message arrived (it writes the inbox files) — it could send a synthetic 'control: stop' or just kill the process.
- difficulties:
  - [annoying] config: MINIH_OUTPUT_PATH and other MINIH_* env vars were not available in the shell session despite the preamble documenting them. Had to use the literal path from the prompt instead. (workaround: Used the literal output path from the prompt text rather than the env var.)
  - [annoying] knowledge: The idle budget baseline is ambiguous when no outside message is ever received. The spec says 'elapsed_since_last_outside_message > idleBudgetMs' but if there is no outside message, the baseline is undefined. Used run start time as the baseline. (workaround: Treated the run start time as the baseline for idle budget calculation.)

## 2026-04-30T22:29:54.728Z — code-review-companion / 2026-05-01T07-56-53-605Z-18dd

- runId: 2026-05-01T07-56-53-605Z-18dd
- runDir: /Users/jordanknight/substrate/minih/agents/code-review-companion/runs/2026-05-01T07-56-53-605Z-18dd
- summary: Code review companion booted and oriented on plan 015-agent-readme-command (DRAFT status, Simple mode). Plan targets a `minih agent-readme` CLI verb plus companion-mode README expansion. Branch is 007-backgrounding. No outside tasks were received during the 30-minute idle budget, so no review work was performed. The companion long-polled the coordination inbox continuously and shut down gracefully on budget expiration.
- **magicWand** (target: coordination): Add a 'first-contact timeout' that's shorter than idleBudgetMs — if NO outside message has ever been received within, say, 5 minutes of boot, exit early with a specific exitReason ('no_peer_contact'). This saves 25 minutes of idle polling when the outside actor simply never shows up. The full idleBudgetMs would still apply after the first real message is received.

## 2026-05-01T06:43:07.187Z — code-review-companion / 2026-05-01T16-32-21-242Z-507d

- runId: 2026-05-01T16-32-21-242Z-507d
- runDir: /Users/jordanknight/substrate/minih/agents/code-review-companion/runs/2026-05-01T16-32-21-242Z-507d
- summary: Reviewed Plan 016 prior work, the demo-companion agent/schema, the main plan commit, and the final fft-fix commit. I sent three Medium findings covering stale Path B/MCP parent-plan wording, demo inside-state schema invariant drift plus a dead prompt cross-reference, and an FX004 flight-plan dependency gap; no High or Critical findings were found.
- **magicWand** (target: coordination): Add a built-in companion session ledger view that groups each outside task with its ack, findings, and summary, plus a generated final-report draft, so long-running reviewers do not need to manually reconstruct counts and ackOf mappings at shutdown.
- difficulties:
  - [annoying] coordination: The final report has to mirror findings already sent through the inbox, but there is no automatic export from the inbox lane into the report JSON. (workaround: Manually copied the three finding payloads and task counts into output/report.json before validation.)

## 2026-05-02T03:36:54.149Z — code-review-companion / 2026-05-02T12-29-45-055Z-6ab1

- runId: 2026-05-02T12-29-45-055Z-6ab1
- runDir: /Users/jordanknight/substrate/minih/agents/code-review-companion/runs/2026-05-02T12-29-45-055Z-6ab1
- summary: Oriented on plan 016 and reviewed three commit-boundary requests covering AGENTS.md dogfood rules, FORCE_COLOR test stabilization, FX007 planning, and FX008 attach/InputBridge implementation. I sent six findings: FX007 setup-race design, AGENTS dogfood drift, coordinated InputBridge fail-closed behavior, and the deferred attach wake e2e. The outside peer reported the AGENTS and InputBridge fail-closed findings fixed in commit 4342735 before stop; I did not independently re-review that final commit before shutdown.
- **magicWand** (target: coordination): Add a companion report-draft tool that derives tasks received, findings sent, summaries, ackOf chains, and unresolved peer requests from the inbox/state lanes, so the final JSON report is generated from the coordination ledger instead of manually reconstructed.
- difficulties:
  - [annoying] coordination: Human in terminal B could not type into a chat with an agent the AI started in terminal A: minih view was read-only cross-process, outside inbox send wrote blind without the live transcript, and resume --human would take over rather than peer-attach. (workaround: The outside peer filed MW12 and implemented FX008/minih attach during the session; I recorded the difficulty for the ledger.)
  - [annoying] coordination: Final report composition required manually copying findings, counts, and ackOf relationships from the coordination transcript into output/report.json. (workaround: Manually reconstructed tasksReceived, findingsSent, findings[], and coordination notes from the inbox messages before validation.)

## 2026-05-03T00:10:38.477Z — code-review-companion / 2026-05-03T09-55-21-823Z-1c80

- runId: 2026-05-03T09-55-21-823Z-1c80
- runDir: /Users/jordanknight/substrate/minih/agents/code-review-companion/runs/2026-05-03T09-55-21-823Z-1c80
- summary: Reviewed FX009 through the coordinated inbox. The initial implementation correctly fixed the live-plus-stale resolver failure but had a MEDIUM contract gap where stale-skip diagnostics were lost on null/fallback paths and a LOW flight-plan acceptance drift. The follow-up commit fixed both original findings; final review found one remaining LOW issue where attach prints duplicated stale-skip diagnostics after the diagnostic plumbing refactor.
- **magicWand** (target: coordination): Add a companion report-draft tool that derives tasks received, findings sent, summaries, ackOf chains, unresolved peer requests, and final counts from the inbox/state lanes so the farewell JSON can be generated from the coordination ledger instead of manually reconstructed.
- difficulties:
  - [annoying] test: I initially used the Jest-style --runInBand flag with Vitest while running the focused resolver test, which Vitest rejected as an unknown option. (workaround: Reran the intended focused test with the repository-supported command: npx vitest run test/runner/run-resolver.test.ts.)

## 2026-05-03T05:45:02.320Z — code-review-companion / 2026-05-03T15-37-38-639Z-4b07

- runId: 2026-05-03T15-37-38-639Z-4b07
- runDir: /Users/jordanknight/substrate/minih/agents/code-review-companion/runs/2026-05-03T15-37-38-639Z-4b07
- summary: Completed post-hoc review of Plan 017 Phase 5 commits 82328d0..23409e5. I sent a REQUEST_CHANGES verdict with one HIGH finding on registry self-install protection running after network fetch, plus one MEDIUM finding on stale registry commit provenance when fetched commits change but manifest-listed files do not.
- **magicWand** (target: coordination): Expose the active coordinated agent input parameters, especially idleBudgetMs, through `minih state get` or a dedicated inside MCP context tool so a companion can know exactly when to exit instead of guessing.
- difficulties:
  - [annoying] coordination: The prompt referenced `input.idleBudgetMs`, but the value was not available through the visible coordination state or inbox context. (workaround: Completed the requested reviews, waited through multiple empty long-poll windows, checked peer state, then exited with idle_budget.)
