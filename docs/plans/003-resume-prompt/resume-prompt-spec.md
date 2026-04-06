# Session Resume & Follow-Up Prompts

**Mode**: Simple

## Research Context

📚 This specification incorporates findings from `research-dossier.md`.

Key findings informing this spec:
- **SDK resume plumbing exists**: `ICopilotClient.resumeSession(sessionId)` and `AgentRunOptions.sessionId` are already implemented in the adapter — the feature is 80% plumbed but not wired to CLI/runner
- **`session.destroy()` is called after every run**: The adapter destroys sessions on completion. Whether destroyed sessions can be resumed via persisted state at `~/.copilot/session-state/` is the #1 technical unknown
- **`-p` is taken**: Already used for `--param`. A separate `resume` command avoids all flag conflicts
- **Session CWD isolation**: Sessions use the run folder as CWD so minih sessions don't pollute the user's `copilot --resume` list (Workshop 005)
- **`completed.json` stores `sessionId`**: The lookup data for resume already exists in every run's artifacts

---

## Summary

When a minih agent run completes, the user has no way to continue the conversation. If the agent missed something, forgot a step, or produced a partial answer, the only option is a full re-run — losing all prior context and wasting time/tokens.

**Session resume** lets users send follow-up messages to a completed agent session, continuing the existing conversation with full history. This transforms minih agents from one-shot tools into conversational partners that can be course-corrected in real time.

```bash
# Agent forgot to check tests? Tell it.
minih resume smoke-test "You didn't validate the test output — please check that too"

# Ask follow-up questions about a review
minih resume code-review "Can you elaborate on the security concern you flagged?"

# Resume a specific older run
minih resume feedback-digest --run 2026-04-06T10-04-29-715Z-e94a "Include the self-review data too"

# Drop into interactive copilot CLI with an agent's session
minih connect smoke-test
# → copilot --yolo --resume=abc-123-def-456   (paste this to continue interactively)

# See all runs and their session IDs
minih connect smoke-test --list
```

---

## Goals

- **Course correction**: Users can tell an agent "you missed X" or "also do Y" without re-running from scratch
- **Follow-up questions**: Users can ask clarifying questions about agent output ("what did you mean by...?")
- **Conversation continuity**: The resumed session has full history — the agent remembers what it already did
- **Artifact continuity**: Each follow-up creates a new run folder linked to the original, preserving the immutable artifact trail
- **Low friction UX**: As simple as `minih resume <slug> "your message"` — no mental overhead
- **Consistent experience**: Pretty mode, event streaming, NDJSON recording all work the same as a fresh run
- **Scriptability**: JSON envelope output, exit codes, and stdin support make resume usable in automation
- **Interactive handoff**: Users can drop from minih into a full interactive Copilot CLI session with the agent's history via `minih connect`

---

## Non-Goals

- **Interactive REPL / chat mode**: This is single follow-up messages, not a persistent interactive shell
- **Cross-agent resume**: Resuming a `smoke-test` session from a `code-review` run — sessions are agent-scoped
- **Automatic retry/repair**: This is user-initiated, not an autonomous retry mechanism
- **Session management commands**: No `minih sessions list` or `minih sessions clean` — session lifecycle is managed by the SDK
- **Modifying completed run artifacts**: Prior run folders remain immutable; follow-ups create new folders
- **Changing model/reasoning mid-conversation**: Resume uses the original session's model configuration

---

## Target Domains

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| adapter | existing | **modify** | Session lifecycle changes — `disconnect()` vs `destroy()`, potential `keepAlive` option |
| runner | existing | **modify** | Thread `sessionId` through `AgentRunConfig` → `runAgent()`, adjust prompt assembly for follow-ups, add session lookup helpers |
| cli | existing | **modify** | New `resume` command, session lookup from completed.json, display integration |

No new domains needed. Import direction `cli → runner → adapter` is preserved.

---

## Complexity

- **Score**: CS-3 (medium)
- **Breakdown**: S=1, I=1, D=1, N=1, F=0, T=1
- **Confidence**: 0.70
- **Assumptions**:
  - SDK `resumeSession()` can reconnect to sessions after `disconnect()` (or even after `destroy()` if state persists on disk)
  - Session conversation history is automatically restored by the SDK on resume
  - No SDK TTL makes sessions unresumable within reasonable timeframes (hours/days)
- **Dependencies**:
  - `@github/copilot-sdk` session persistence behavior (unknown — needs empirical testing or deep research)
- **Risks**:
  - ~~`destroy()` may permanently wipe session state → requires adapter lifecycle changes~~ → **Resolved**: switching all runs to `disconnect()` (same as `compact()`)
  - SDK may have a session TTL that makes old sessions unresumable → need graceful fallback
  - Session CWD update on resume may interact with isolation strategy
- **Phases**: Single phase likely sufficient given existing plumbing

---

## Testing Strategy

- **Approach**: Lightweight
- **Rationale**: Core logic is session lookup (completed.json parsing) and sessionId pass-through wiring. SDK interactions can't be unit-tested without real auth. FakeAgentAdapter already supports sessionId.
- **Focus Areas**:
  - Session lookup: find latest run, find specific run by ID, missing/corrupt completed.json
  - Runner resume path: sessionId threaded through to adapter.run()
  - CLI command registration and argument parsing
- **Excluded**: E2E SDK session resume (requires live auth + real sessions)
- **Mock Usage**: Targeted mocks — FakeAgentAdapter for adapter boundary, filesystem fixtures for completed.json

---

## Acceptance Criteria

**AC1**: Running `minih resume <slug> "message"` sends the message to the most recent completed run's session and streams the agent's response

**AC2**: Running `minih resume <slug> --run <runId> "message"` resumes a specific historical run by its run ID

**AC3**: The resumed session has full conversation history — the agent can reference what it did in the original run without the user re-explaining

**AC4**: A new timestamped run folder is created for the resumed run (immutable artifact convention), containing its own `events.ndjson`, `completed.json`, and `output/report.json`

**AC5**: The resumed run's `completed.json` includes a `resumedFromRunId` field linking it to the original run

**AC6**: Pretty mode is the default display for resume (same as `run`), with `--verbose` available

**AC7**: The JSON envelope on stdout includes resume-specific fields (`resumedFromRunId`, `originalSessionId`)

**AC8**: If the session cannot be resumed (expired, destroyed, missing), the CLI exits with a clear, actionable error message (e.g., "Session not found — run `minih run <slug>` for a fresh start")

**AC9**: `minih resume --help` shows command usage with examples

**AC10**: `minih history <slug>` shows resumed runs with a visible indicator (e.g., `↩` or `resumed`) linking them to the original

**AC11**: CWD isolation is maintained — resumed sessions don't appear in the user's `copilot --resume` list at the project root

**AC12**: The follow-up message can be provided via stdin: `echo "check tests" | minih resume <slug>`

### Connect Command

**AC13**: Running `minih connect <slug>` prints a ready-to-paste command that `cd`s to the run folder and launches `copilot --yolo --resume=<sessionId>` for the most recent run (e.g., `cd /path/to/run/dir && copilot --yolo --resume=abc-123`)

**AC14**: Running `minih connect <slug> --run <runId>` prints the connect command for a specific historical run

**AC15**: Running `minih connect <slug> --list` shows all runs for the agent with their session IDs, run IDs, timestamps, and status — so the user can pick which session to connect to

**AC16**: The connect command's JSON envelope (stdout) includes the sessionId and the copilot CLI command string for scripting

---

## Risks & Assumptions

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| ~~`destroy()` permanently wipes session state~~ | ~~Medium~~ | ~~High~~ | **Resolved**: switching all runs to `disconnect()` |
| SDK session TTL expires before user resumes | Low | Medium | Graceful error message with fallback suggestion |
| `disconnect()` doesn't actually preserve resumable state | Low | High | Empirical SDK test in scratch script before implementation |
| Session CWD update on resume breaks isolation | Low | Low | New run folder CWD maintains isolation regardless |

**Assumptions**:
- Users will typically resume within minutes to hours, not days/weeks
- A single follow-up message per `resume` invocation is sufficient (not multi-turn REPL)
- The SDK preserves tool permissions and working directory on session resume
- System output validation (summary + retrospective) is **not enforced** for resume — the user is asking a pointed question, not requesting a full agent report. Raw agent output is saved to `output/report.json` as-is.

---

## Open Questions

All resolved — see Clarifications below.

---

## Documentation Strategy

- **Location**: README.md only
- **Rationale**: README already has the CLI reference table with all commands. Add `resume` to the table and a usage example.

---

## Clarifications

### Session 2026-04-06

**Q1: Workflow Mode** → **Simple**. Single phase, inline tasks — the plumbing is 80% done.

**Q2: Testing Strategy** → **Lightweight**. Unit tests for session lookup + resume wiring. No E2E SDK tests. FakeAgentAdapter already supports sessionId pass-through.

**Q3: Session Cleanup Strategy** → **Switch ALL runs to `disconnect()`**. Same pattern as `compact()`. Sessions persist in `~/.copilot/session-state/` for potential resume. SDK manages its own cleanup. This resolves the #1 risk.

**Q4: System Output Enforcement** → **No enforcement on resume**. The user is asking a quick follow-up, not requesting a full structured report. Raw output saved to `output/report.json` as-is.

**Q5: Prompt Assembly for Resume** → **Just the follow-up message**. SDK conversation history already has full context (preamble, instructions, prior exchanges). No re-injection needed.

**Q6: Documentation Strategy** → **README.md only**. Add `resume` to existing CLI reference table + usage example.

**Q7: Domain Review** → **Confirmed as-is**. All 3 existing domains modified: adapter (disconnect), runner (sessionId wiring + lookup), cli (new command). No new domains. Import direction preserved.

**Additional: Empirical SDK Test** → User wants a quick isolated scratch script test of `disconnect()` + `resumeSession()` before implementation begins. This validates the core assumption that sessions survive `disconnect()` and can be resumed with follow-up messages.

**Additional: Connect Command** → New `minih connect <slug>` command that prints a ready-to-paste `copilot --yolo --resume=<sessionId>` command. Just prints — doesn't exec. Supports `--run <runId>` for specific runs and `--list` to show all runs with session IDs. Enables users to drop from minih into interactive Copilot CLI with the agent's conversation history.

---

## Workshop Opportunities

| Topic | Type | Why Workshop | Key Questions |
|-------|------|--------------|---------------|
| ~~Session lifecycle for resume~~ | ~~Integration Pattern~~ | **Resolved**: switch all runs to `disconnect()` | N/A |
| ~~Resume prompt assembly~~ | ~~API Contract~~ | **Resolved**: just send the follow-up message | N/A |
| Resume run folder linking | Data Model | How do run folders express parent-child relationships? Affects history display and artifact navigation. | `resumedFromRunId` only? Symlinks? Index file? Chain of resumes? |

**Pre-implementation gate**: Run empirical SDK test script to validate `disconnect()` → `resumeSession()` → `sendAndWait()` works.
