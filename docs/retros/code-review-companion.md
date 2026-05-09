
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

## 2026-05-03T06:24:56.659Z — code-review-companion / 2026-05-03T16-08-00-909Z-ca43

- runId: 2026-05-03T16-08-00-909Z-ca43
- runDir: /Users/jordanknight/substrate/minih/agents/code-review-companion/runs/2026-05-03T16-08-00-909Z-ca43
- summary: Reviewed Plan 017 Phase 6 documentation across eight task/fix requests. The companion found eleven substantive issues: user-facing confirmation-prompt and E184 contract drift in the agent-pack how-to, security-model overstatements, runner domain-doc drift around registry fetch behavior, stale plan-spec trust wording, and plan hygiene gaps. All findings were addressed by the final fix commit 7c39fc8; the final verification approved the phase with no open findings.
- **magicWand** (target: project): Add a `minih review-drift` or `minih grep-contract` helper that safely searches changed docs for old contract phrases without shell-quoting hazards and reports current source-of-truth hits by category.
- difficulties:
  - [annoying] debug: A drift-audit grep pattern containing markdown backticks was passed through the shell in double quotes, causing command substitution attempts before grep ran. (workaround: Re-ran the wording sweep with safer single-quoted/literal patterns and avoided backticks in shell-interpreted strings.)
  - [annoying] coordination: The T6.3 review request referenced commit 982af5c, but the AGENTS.md change it described was actually in the next commit, 26e3184. (workaround: Checked git log and blame for AGENTS.md, then reviewed the real T6.3 commit while noting the SHA mismatch in the summary.)

## 2026-05-04T04:34:17.653Z — code-review-companion / 2026-05-04T14-25-55-619Z-29ec

- runId: 2026-05-04T14-25-55-619Z-29ec
- runDir: /Users/jordanknight/substrate/minih/agents/code-review-companion/runs/2026-05-04T14-25-55-619Z-29ec
- summary: Oriented on plan 018-agent-permissions, acknowledged the outside briefing for the full R1-R6 permissions rollout, and remained idle listening for commit-boundary review requests. No review tasks arrived before idle-budget shutdown, so no findings were produced.
- **magicWand** (target: coordination): Expose the configured idleBudgetMs and elapsed idle timer in `minih status <slug> --run <run>` or `state_get` so long-running coordinated agents can make shutdown decisions without guessing.
- difficulties:
  - [annoying] coordination: The prompt required comparing elapsed idle time with input.idleBudgetMs, but that configured idle budget was not surfaced in coordination state or status output during the run. (workaround: Used repeated bounded inbox polls and stopped after several empty windows once no scoped review work arrived.)

## 2026-05-04T04:48:29.314Z — code-review-companion / 2026-05-04T14-41-22-322Z-1ec2

- runId: 2026-05-04T14-41-22-322Z-1ec2
- runDir: /Users/jordanknight/substrate/minih/agents/code-review-companion/runs/2026-05-04T14-41-22-322Z-1ec2
- summary: Oriented on plan 018-agent-permissions and acknowledged the outside briefing for R2-R6/stretch/FX/prober review protocol. No review-request tasks arrived before the idle budget shutdown, so no findings were produced.
- **magicWand** (target: coordination): Expose the active run input, especially idleBudgetMs, via `minih status <slug> --run <id>` or a dedicated dogfood-safe `minih input get` command so coordinated agents can apply their lifecycle contract precisely without reading run-dir files.
- difficulties:
  - [annoying] coordination: Could not determine the configured idle budget through a dogfood-safe CLI/status surface. (workaround: Used repeated empty long-polls plus `minih status` elapsed/run activity as evidence before exiting with idle_budget.)

## 2026-05-04T04:53:33.073Z — code-review-companion / 2026-05-04T14-49-56-336Z-f7d6

- runId: 2026-05-04T14-49-56-336Z-f7d6
- runDir: /Users/jordanknight/substrate/minih/agents/code-review-companion/runs/2026-05-04T14-49-56-336Z-f7d6
- summary: Oriented on docs/plans/018-agent-permissions, confirmed the active plan is ready for implementation, noted the latest permissions tooling commit and one modified worktree file, then received no review requests before the idle budget elapsed. No code review findings were produced.
- **magicWand** (target: coordination): Expose the effective idleBudgetMs and initialTask values through a small inside context/status command so long-running coordinated agents can make lifecycle decisions without guessing from prompt text or run artifacts.
- difficulties:
  - [annoying] knowledge: Effective idleBudgetMs was mentioned by the companion protocol but not available via inbox/state tooling, making the shutdown threshold ambiguous. (workaround: Used several bounded 30-second idle polls after orientation before treating the run as idle-budget complete.)

> ⚠️ ## 2026-05-04T05:30:29.954Z — code-review-companion / 2026-05-04T15-22-27-530Z-0247
>
> - runId: 2026-05-04T15-22-27-530Z-0247
> - runDir: /Users/jordanknight/substrate/minih/agents/code-review-companion/runs/2026-05-04T15-22-27-530Z-0247
> - result: failed
> - magicWand: (unavailable — run terminated as failed)
> - stderr (last line): permission denied: kind=write blocked by preset/overrides

> ⚠️ ## 2026-05-04T08:34:56.231Z — code-review-companion / 2026-05-04T17-44-06-832Z-836e
>
> - runId: 2026-05-04T17-44-06-832Z-836e
> - runDir: /Users/jordanknight/substrate/minih/agents/code-review-companion/runs/2026-05-04T17-44-06-832Z-836e
> - result: failed
> - magicWand: (unavailable — run terminated as failed)
> - stderr (last line): permission denied: kind=write blocked by preset/overrides

## 2026-05-04T08:53:28.739Z — code-review-companion / 2026-05-04T18-36-51-531Z-a795

- runId: 2026-05-04T18-36-51-531Z-a795
- runDir: /Users/jordanknight/substrate/minih/agents/code-review-companion/runs/2026-05-04T18-36-51-531Z-a795
- summary: Reviewed FX008 continuation commits ec4d1d9 and c448268. The early E205 signal-failure handling looked directionally sound, and the final docs improved the E205 operator journey, but the final landing still needs changes: the new CLI regression test times out in this checkout, its claimed 5-signal coverage omits coordinated state/inbox assertions, and stale presetSource provenance wording remains.
- **magicWand** (target: coordination): Add a dogfood-safe `minih inside context get` or `permission_status`-style lifecycle tool that exposes initialTask, idleBudgetMs, run timing, and output path metadata without reading run-dir files directly.
- difficulties:
  - [annoying] knowledge: Effective idleBudgetMs is part of the companion protocol but was not exposed through the inside coordination tools or dogfood-safe minih status surface. (workaround: Stayed alive until the outside actor sent an explicit control:stop, rather than attempting to infer the idle budget from run-dir files.)
  - [degrading] test: The newly added FX008 CLI regression test timed out in the review environment, despite the commit summary claiming the gate was green. (workaround: Reported the failing narrow command as a HIGH review finding instead of treating the final landing as complete.)

## 2026-05-06T21:54:14.031Z — code-review-companion / 2026-05-07T07-27-42-890Z-09c6

- runId: 2026-05-07T07-27-42-890Z-09c6
- runDir: /Users/jordanknight/substrate/minih/agents/code-review-companion/runs/2026-05-07T07-27-42-890Z-09c6
- summary: Reviewed the full plan 019 companion idle check-in protocol implementation across schema, prompt, instructions, docs, tests, fix bundles, and final drain. Sent seven findings plus one T006 deferral pushback; the findings covered schema/spec mismatch, prompt post-task gating, workshop vocabulary drift, instruction timing drift, orchestrator reply type drift, missing regression coverage, and residual wording drift. The peer reported all findings were folded before stop, and the final phase state is suitable to ship after the last F007 fold.
- **magicWand** (target: coordination): Add a coordination workbench view that shows open findings by ack chain and whether a later task/commit claims each one was folded, so final-drain reviews can verify unresolved items without manually re-reading every prior inbox message.
- difficulties:
  - [annoying] debug: Targeted rg searches using brace globs over absolute paths sometimes reported no matches even when the same files contained matching text visible via focused reads. (workaround: Used direct view calls for the relevant current sections and narrower rg/path combinations for drift checks.)

> ⚠️ ## 2026-05-06T22:31:43.977Z — code-review-companion / 2026-05-07T08-31-43-922Z-bdd6
>
> - runId: 2026-05-07T08-31-43-922Z-bdd6
> - runDir: /Users/jordanknight/substrate/minih/agents/code-review-companion/runs/2026-05-07T08-31-43-922Z-bdd6
> - result: failed
> - magicWand: (unavailable — run terminated as failed)
> - stderr (last line): Input parameter validation failed:

## 2026-05-06T22:40:43.213Z — code-review-companion / 2026-05-07T08-36-36-851Z-feed

- runId: 2026-05-07T08-36-36-851Z-feed
- runDir: /Users/jordanknight/substrate/minih/agents/code-review-companion/runs/2026-05-07T08-36-36-851Z-feed
- summary: Completed the requested smoke-test review: oriented successfully on plan 019, accepted the task as first engagement to reset the idle/check-in streak, echoed the loop-state counters, sent a zero-finding summary, and stopped on outside control.
- **magicWand** (target: minih): Add a first-class minih CLI recipe for starting a coordinated agent with typed JSON input overrides, e.g. a documented `minih run <slug> --input-json '{...}'` path that is easy for orchestrators to use for tight-threshold lifecycle smoke tests.
- difficulties:
  - [annoying] knowledge: The orient default asks for the most recently modified phase folder under tasks, but the active plan has no tasks folder, so the expected status source was absent. (workaround: Used the plan spec, flight plan, workshop, and recent git history as the orient source of truth.)

## 2026-05-09T00:28:40.534Z — code-review-companion / 2026-05-09T10-25-25-419Z-8784

- runId: 2026-05-09T10-25-25-419Z-8784
- runDir: /Users/jordanknight/substrate/minih/agents/code-review-companion/runs/2026-05-09T10-25-25-419Z-8784
- summary: Oriented on plan 020-minih-harness-measurement, found it is currently research/workshop-only with no feature spec or task phase yet, sent the required idle check-in, and stood down after no outside task or reply arrived.
- **magicWand** (target: project): Add a minih-facing plan-orient command that summarizes the active plan folder regardless of whether it is in spec/plan/tasks form or research/workshop form, so companions do not need to infer plan status from directory shape.
- difficulties:
  - [annoying] knowledge: The active plan did not contain the spec, plan, or tasks files expected by the companion orient default, because it is still a research/workshop handover. (workaround: Listed the actual plan folder contents and used the handover, research dossier, latest workshop, and recent git history for orientation.)
