# Retros Ledger

This directory holds the **agent retrospective ledger** — the persistent record of every `magicWand` and `difficulties` entry that minih agents have produced for this project.

Why this exists: every minih run produces a retrospective. Without a place to land, those retros vanish into per-run directories. This ledger is the consumer side of that loop — what makes "I ran an agent" turn into "my agent harness got better".

## Files

| Pattern | Owner | Notes |
|---------|-------|-------|
| `<agent-slug>.md` | minih runner (auto-append) + `minih harvest` (manual) | Per-agent ledger, all retros for one agent over time |
| `<plan-id>.md` | minih runner (auto-append when `MINIH_PLAN_ID` is set) + `minih harvest` (manual) | Per-plan ledger, all retros emitted under one plan's umbrella |
| `README.md` | this file | Convention guide |

The same retro lands in **both** the per-agent and per-plan files when `MINIH_PLAN_ID` is set in the run's environment. When it isn't, only the per-agent file is written.

## Entry Format

Each successful run produces one Markdown block like:

```markdown
## 2026-04-29T01:02:03.456Z — code-review-companion / 2026-04-29T01-02-03-456Z-abcd

- runId: 2026-04-29T01-02-03-456Z-abcd
- runDir: /abs/path/to/agents/code-review-companion/runs/2026-04-29T01-02-03-456Z-abcd
- planId: 011-retro-harvest-loop
- summary: Reviewed HF-A bundle; 2 findings.
- **magicWand** (target: minih): peerIdleSince in coordination state
- difficulties:
  - [minor] tooling: companion outside.md broke during rename (workaround: re-run after sweep)
```

Runs that terminated without a retrospective (timeout, crash, schema-fail) produce a `> ⚠️` blockquote-prefixed stub:

```markdown
> ⚠️ ## 2026-04-29T01:02:03.456Z — code-review-companion / 2026-04-29T01-02-03-456Z-abcd
>
> - runId: 2026-04-29T01-02-03-456Z-abcd
> - runDir: /abs/path/to/runs/2026-04-29T01-02-03-456Z-abcd
> - result: timeout
> - magicWand: (unavailable — run terminated as timeout)
> - stderr (last line): Agent timed out after 300s
```

## Capture mechanisms

- **Auto-append (default)**: every successful run with a `retrospective` is appended automatically when the runner finalizes. Set `MINIH_NO_AUTO_HARVEST=1` to suppress.
- **Manual / batch**: `minih harvest <slug>` — captures the latest run. `minih harvest <slug> --since <ref>` — batch since a git ref or ISO timestamp.
- **Audit**: `minih doctor` lists any run dirs whose retrospective was never harvested.

## Privacy

Retro content is **LLM-generated** and **committed to git by default**. Review entries before pushing — `magicWand` and `difficulties` may include code snippets, file paths, or environment details. Options:

- Set `MINIH_NO_AUTO_HARVEST=1` for sensitive runs.
- Add `docs/retros/` to `.gitignore` if you'd rather curate manually.
- Hand-edit entries before commit; the writer is append-only but human edits won't break the format.

## Idempotency

Each entry is keyed by `runId`. Re-harvesting the same run is a no-op (the writer scans for `runId: <id>` lines before appending). Duplicate entries from race retries are similarly de-duplicated.

## Triage

Periodically scan the ledger and pull `magicWand` items that recur across multiple runs into the next plan's task list. That is the single highest-leverage motion in the harness.
