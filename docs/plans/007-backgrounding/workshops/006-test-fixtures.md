# Workshop: Test Fixtures for Two-Agent Coordination

**Type**: Other (Testing)
**Plan**: 007-backgrounding
**Spec**: [coordination-spec.md](../coordination-spec.md)
**Created**: 2026-04-26
**Status**: Draft

**Related Documents**:
- [research-dossier.md](../research-dossier.md) — QT-02, QT-05, QT-06 (FakeAgentAdapter extensibility, concurrency, two-agent gap)
- [001-filesystem-layout.md](001-filesystem-layout.md) — defines what tests need to read/assert
- [002-state-machine.md](002-state-machine.md) — defines transition rules + error codes tests must verify
- [003-mcp-tool-surface.md](003-mcp-tool-surface.md) — defines tool contracts under test
- [004-spawn-config-injection.md](004-spawn-config-injection.md) — defines the regression-test target (AC-MCP-CLEAN)
- [external-research/mcp-leak-validation.md](../external-research/mcp-leak-validation.md) — empirical baseline for the regression test

**Domain Context**:
- **Primary Domain**: `runner` (state.ts, folder.ts, validators have their own unit tests); `mcp` (tool dispatch + spawn module need integration tests)
- **Cross-domain**: end-to-end coordination tests span cli + mcp + runner

---

## Purpose

Build the test infrastructure that lets us verify two-agent coordination flows reliably and cheaply. Per `research-dossier.md` QT-06, the existing fixture set doesn't support this: `FakeAgentAdapter` is single-agent; CLI tests are slow execSync wrappers; no precedent for "outside writes inbox → inside reads inbox" round-trips. This workshop pins **the fixture shape, the mocking strategy, and the test categories that map onto the spec's 17 ACs**.

## Key Questions Addressed

- Extend `FakeAgentAdapter` with shared inbox/state state, or build a separate `TestHarness`?
- Mock the MCP server completely, or spawn the real one to a tmpdir?
- How do we time-travel for state-history timestamps (fake timers)?
- How do we test the AC-MCP-CLEAN regression reliably across CI?
- What's the smallest set of integration tests that gives high confidence in the contract?

---

## Strategy: Three Test Layers

### Layer 1: Pure-runner unit tests (fastest, broadest coverage)

Targets: `state.ts`, `folder.ts` extensions, schemas, validators.
Pattern: existing `test/runner/` style — vitest, tmpdir, sync I/O assertions.
No SDK, no MCP, no spawning.

### Layer 2: MCP-server integration tests (medium speed, contract validation)

Targets: tool dispatch, baked-context resolution, error envelopes.
Pattern: spawn the REAL MCP server child against a tmpdir; talk to it via a test MCP CLIENT (also from `@modelcontextprotocol/sdk`); assert tool I/O.
No SDK CLI; no real Copilot.

### Layer 3: End-to-end coordination tests (slowest, full-stack)

Targets: AC-MCP-CLEAN regression; full inbox round-trip via real `minih run`.
Pattern: real CLI invocation against a coordination-aware test agent; FakeAgentAdapter (so no real LLM call) but real MCP server child + real filesystem.
Slow but high-confidence.

---

## Layer 1: Pure-Runner Unit Tests

### What's testable without SDK or MCP

- `state.ts`:
  - `isAllowedTransition(side, from, to, peerState, rules)` — every transition combination, every gated transition, custom rules per agent.
  - Schema validation of state files (outside-state, inside-state).
  - Schema validation of state-history-entry.
  - Lazy-default behavior on missing files.
  - Atomic write helper (`writeStateAtomic`) — temp + rename, no partial reads.
- `folder.ts` extensions:
  - `loadInboxLane(side, slug, agentsDir)` — returns parsed message array; handles missing file (empty); handles malformed lines (skip + log).
  - `appendInboxMessage(side, slug, agentsDir, message)` — appends NDJSON line; validates against schema.
  - `getInboxPath`, `getStatePath`, `getHistoryPath` — pure functions.
- `context.ts`:
  - `detectContext()` returns `'inside'` when `MINIH=1`, `'outside'` otherwise.
  - `assertContext('outside')` exits with the right envelope when called inside.

### Test file layout

```
test/
└── runner/
    ├── state.test.ts          ← isAllowedTransition + lazy-default
    ├── state-history.test.ts  ← appendHistory, replay history
    ├── state-schema.test.ts   ← AJV validation of outside/inside state JSON
    ├── inbox-folder.test.ts   ← loadInboxLane, appendInboxMessage
    ├── inbox-schema.test.ts   ← AJV validation of inbox messages
    ├── context.test.ts        ← detectContext, assertContext
    └── helpers/
        ├── coordination-fixtures.ts  ← builders for state objects + messages
        └── tmp-agent.ts              ← helper to scaffold an agent dir in tmpdir
```

### Example test: state.transition gate

```ts
// test/runner/state.test.ts
import { describe, it, expect } from 'vitest';
import { isAllowedTransition, DEFAULT_TRANSITIONS } from '../../src/runner/state.js';

describe('isAllowedTransition', () => {
  it('inside reviewing→complete is GATED when peer is not done', () => {
    const result = isAllowedTransition(
      'inside', 'reviewing', 'complete',
      { phase: 'in-progress' }, DEFAULT_TRANSITIONS
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('GATED');
      expect(result.details).toMatchObject({
        requiredPeerPhase: ['done'],
        actualPeerPhase: 'in-progress',
      });
    }
  });

  it('inside reviewing→complete succeeds when peer is done', () => {
    const result = isAllowedTransition(
      'inside', 'reviewing', 'complete',
      { phase: 'done' }, DEFAULT_TRANSITIONS
    );
    expect(result.ok).toBe(true);
  });

  it('returns INVALID with allowed-from list when no rule exists', () => {
    const result = isAllowedTransition(
      'outside', 'done', 'in-progress',
      { phase: 'idle' }, DEFAULT_TRANSITIONS
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('INVALID');
      expect(result.reason).toContain('Allowed transitions from "done"');
    }
  });

  // ... full coverage matrix
});
```

### Example test: lazy default state

```ts
// test/runner/state.test.ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupTmpAgent } from './helpers/tmp-agent.js';
import { loadStateLazy } from '../../src/runner/state.js';

it('returns synthetic idle state when file does not exist', () => {
  const { agentsDir } = setupTmpAgent({ slug: 'test-agent' });
  const state = loadStateLazy('inside', 'test-agent', agentsDir);
  expect(state.phase).toBe('idle');
  expect(state.data).toEqual({});
  expect(state.updatedBy).toBe('inside');
  // File should NOT have been created
  expect(existsSync(join(agentsDir, 'test-agent', 'state', 'inside.json'))).toBe(false);
});
```

---

## Layer 2: MCP-Server Integration Tests

### Why spawn the real server (not mock)

The whole point of the inside-channel design is that the MCP server is the contract boundary. Mocking it would mean testing our own mock; testing the real server end-to-end (over stdio) is the only way to catch contract drift.

### Test client pattern

Use `@modelcontextprotocol/sdk`'s client side to talk to a spawned server child:

```ts
// test/mcp/helpers/test-client.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn, type ChildProcess } from 'node:child_process';

export interface SpawnedMcp {
  client: Client;
  process: ChildProcess;
  shutdown: () => Promise<void>;
}

export async function spawnInsideMcp(env: Record<string, string>): Promise<SpawnedMcp> {
  const proc = spawn('node', ['dist/mcp/inside-server.cjs'], {
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const transport = new StdioClientTransport({
    reader: proc.stdout!,
    writer: proc.stdin!,
  });
  const client = new Client({ name: 'test-client', version: '0.0.1' }, { capabilities: {} });
  await client.connect(transport);

  return {
    client,
    process: proc,
    shutdown: async () => {
      try { await client.close(); } catch {}
      proc.kill('SIGTERM');
      await new Promise((r) => proc.on('exit', r));
    },
  };
}
```

### Example: full inbox round-trip

```ts
// test/mcp/inbox.integration.test.ts
import { mkdtempSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnInsideMcp, type SpawnedMcp } from './helpers/test-client.js';

describe('inside-MCP server: inbox round-trip', () => {
  let tmpAgents: string;
  let mcp: SpawnedMcp;

  beforeEach(async () => {
    tmpAgents = mkdtempSync(join(tmpdir(), 'minih-mcp-test-'));
    const agentDir = join(tmpAgents, 'test-agent');
    mkdirSync(join(agentDir, 'inbox', 'outside'), { recursive: true });
    mkdirSync(join(agentDir, 'inbox', 'inside'),  { recursive: true });
    mkdirSync(join(agentDir, 'state'), { recursive: true });

    mcp = await spawnInsideMcp({
      MINIH_MCP_RUN_ID:         'test-run-001',
      MINIH_MCP_RUN_DIR:        join(agentDir, 'runs', 'test-run-001'),
      MINIH_MCP_AGENT_SLUG:     'test-agent',
      MINIH_MCP_AGENTS_DIR:     tmpAgents,
      MINIH_MCP_INBOX_DIR:      join(agentDir, 'inbox'),
      MINIH_MCP_STATE_DIR:      join(agentDir, 'state'),
      MINIH_MCP_SIDE:           'inside',
      MINIH_MCP_PROCESS_MARKER: 'minih-mcp-test-run-001',
    });
  });

  afterEach(async () => {
    await mcp.shutdown();
    rmSync(tmpAgents, { recursive: true, force: true });
  });

  it('lists empty inbox when no outside messages exist', async () => {
    const result = await mcp.client.callTool({ name: 'inbox.list', arguments: { unread: true } });
    expect(result.isError).toBeFalsy();
    const content = JSON.parse(/* extract from result.content */);
    expect(content.messages).toEqual([]);
  });

  it('inbox.send appends to inside lane and is readable from disk', async () => {
    await mcp.client.callTool({
      name: 'inbox.send',
      arguments: { type: 'ack', subject: 'review done', body: 'no issues' },
    });

    const insideLane = readFileSync(
      join(tmpAgents, 'test-agent', 'inbox', 'inside', 'messages.ndjson'),
      'utf8'
    );
    const lines = insideLane.trim().split('\n');
    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed).toMatchObject({
      sender: 'inside',
      type: 'ack',
      subject: 'review done',
      body: 'no issues',
    });
    expect(parsed.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/); // ULID
  });

  it('inbox.list returns peer messages and respects unread filter', async () => {
    // Pre-seed an outside message
    const outsideMsg = {
      id: '01J3000000000000000000000000',
      sender: 'outside', type: 'note', subject: 'phase 2 done', body: 'ready',
      ts: '2026-04-26T10:00:00.000Z',
    };
    writeFileSync(
      join(tmpAgents, 'test-agent', 'inbox', 'outside', 'messages.ndjson'),
      JSON.stringify(outsideMsg) + '\n'
    );

    const result = await mcp.client.callTool({ name: 'inbox.list', arguments: { unread: true } });
    const content = JSON.parse(/* extract */);
    expect(content.messages).toHaveLength(1);
    expect(content.messages[0]).toMatchObject({ subject: 'phase 2 done' });

    // Ack it
    await mcp.client.callTool({ name: 'inbox.ack', arguments: { msgId: '01J3000000000000000000000000' } });

    // Now unread should be empty
    const result2 = await mcp.client.callTool({ name: 'inbox.list', arguments: { unread: true } });
    const content2 = JSON.parse(/* extract */);
    expect(content2.messages).toHaveLength(0);
  });
});
```

### Example: state.transition gate test (real MCP)

```ts
it('state.transition reviewing→complete is GATED when peer not done', async () => {
  // Pre-seed inside in 'reviewing'
  writeFileSync(
    join(tmpAgents, 'test-agent', 'state', 'inside.json'),
    JSON.stringify({ phase: 'reviewing', data: {}, updatedAt: '2026-04-26T10:00:00Z', updatedBy: 'inside' })
  );
  // Outside still 'in-progress'
  writeFileSync(
    join(tmpAgents, 'test-agent', 'state', 'outside.json'),
    JSON.stringify({ phase: 'in-progress', data: {}, updatedAt: '2026-04-26T10:00:00Z', updatedBy: 'outside' })
  );

  const result = await mcp.client.callTool({
    name: 'state.transition', arguments: { to: 'complete', reason: 'review done' },
  });

  expect(result.isError).toBe(true);
  expect(result._meta?.code).toBe('GATED');
  expect(result._meta?.actualPeerPhase).toBe('in-progress');

  // Inside state file should NOT have been mutated
  const insideStateAfter = JSON.parse(readFileSync(
    join(tmpAgents, 'test-agent', 'state', 'inside.json'), 'utf8'
  ));
  expect(insideStateAfter.phase).toBe('reviewing');
});
```

### Test file layout

```
test/
└── mcp/
    ├── inbox.integration.test.ts
    ├── state.integration.test.ts
    ├── transition-gate.integration.test.ts  ← the user's invariant
    ├── tool-error-envelope.test.ts          ← typed errors render correctly
    ├── coexist-with-user-mcp.test.ts        ← AC-MCP-COEXIST
    └── helpers/
        ├── test-client.ts                   ← spawnInsideMcp + Client wrapper
        └── seed-fixtures.ts                 ← pre-seed inbox/state files
```

---

## Layer 3: End-to-End Coordination Tests (with FakeAgentAdapter)

### Why FakeAgentAdapter (not real Copilot)

E2E tests should not require `GH_TOKEN` or burn tokens. The FakeAgentAdapter pattern (existing for runner unit tests) extends naturally — we configure pre-recorded events that simulate an agent calling `inbox.send`/`state.transition` via tool calls, and assert the post-run filesystem state.

But: for true E2E that proves the MCP server spawning works, we need to actually run the spawn pipeline. The fake adapter still drives, but the SDK's MCP plumbing is bypassed (FakeAgentAdapter doesn't talk to a real session).

So we have two flavors:

#### 3a. CLI + state/inbox + FakeAgentAdapter (fast E2E)

Tests that the CLI orchestration writes to inbox/state correctly when an "agent" simulates tool calls. FakeAgentAdapter pre-records `tool_call` events that LOOK like `inbox.send` calls; the test asserts the inbox file changed.

This bypasses the real MCP server (FakeAgentAdapter doesn't actually spawn one). It tests CLI + runner only.

```ts
// test/coordination/cli-outside-flows.test.ts
it('minih outside-send appends to outside lane', () => {
  // setup tmp agents dir with one agent
  const result = execSync(
    `node dist/cli/index.js outside-send test-agent --type note --subject "..." --body "..."`,
    { env: { ...process.env, MINIH_AGENTS_DIR: tmpAgents } }
  );
  const envelope = JSON.parse(result.toString());
  expect(envelope.status).toBe('ok');
  expect(envelope.data.messageId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  // assert filesystem
  const lane = readFileSync(join(tmpAgents, 'test-agent', 'inbox', 'outside', 'messages.ndjson'), 'utf8');
  expect(JSON.parse(lane.trim())).toMatchObject({ sender: 'outside', type: 'note' });
});
```

#### 3b. Real spawn end-to-end (the AC-MCP-CLEAN regression)

Tests the full pipeline: CLI invokes `minih run`, which spawns the SDK CLI, which spawns the inside-channel MCP child. We can't easily run a real LLM in CI, so we use a **deterministic local model** OR mark this test as "manual / nightly-only" using vitest's `it.skipIf(process.env.CI)`.

Better approach: use `gpt-5.5 --no-reasoning` (per session policy) against the smoke-test agent — it costs a few cents per CI run. Add a separate vitest project `test-e2e` that's opt-in via `npm run test:e2e`.

```ts
// test/e2e/mcp-cleanup.test.ts
import { execSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';

const RUN_ID_REGEX = /minih-mcp-([\dT\-Z]+-[a-f0-9]+)/;

it('coordination-smoke run reaps MCP child within 5s', async () => {
  const output = execSync(
    `node dist/cli/index.js run coordination-smoke --model gpt-5.5 --no-reasoning`,
  ).toString();
  const envelope = JSON.parse(output.split('\n').reverse().find((l) => l.startsWith('{"command"'))!);
  expect(envelope.status).toBe('ok');

  // Wait 5s, then pgrep for any leaked minih-mcp-* process
  await sleep(5000);
  const leaked = pgrepAll('minih-mcp-');
  expect(leaked).toEqual([]);
});
```

### A new smoke-test agent: `agents/coordination-smoke/`

```yaml
---
description: Smoke test for the coordination plumbing (inbox + state + MCP)
coordination: enabled
---

# Coordination Smoke Test

Verify the inside MCP server tools work end-to-end.

## Steps

1. Call `state.get({ side: 'self' })` — assert your initial state is `phase: 'idle'`.
2. Call `state.transition({ to: 'in-progress', reason: 'starting smoke test' })` — assert success.
3. Call `inbox.send({ type: 'note', subject: 'hello', body: 'smoke test message' })` — assert returns `messageId`.
4. Call `inbox.list()` — assert your sent message is NOT in the result (it's in your outgoing lane, not your incoming lane).
5. Call `state.transition({ to: 'reviewing' })` — assert success.
6. Call `state.transition({ to: 'complete' })` — assert this is GATED (outside.json doesn't have phase: done).
7. In your report, document each assertion result.
```

This agent does not require any outside coordination — it just exercises every tool. The MCP-CLEAN regression test invokes this agent, asserts the report is well-formed, and asserts no MCP processes leak.

---

## Time-Travel for Deterministic Timestamps

Inbox messages and state history both stamp `ts` server-side. To keep tests deterministic:

```ts
import { vi } from 'vitest';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-04-26T10:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

it('inbox.send stamps ts from system clock', async () => {
  // ...
  const lane = readFileSync(...);
  const msg = JSON.parse(lane.trim());
  expect(msg.ts).toBe('2026-04-26T10:00:00.000Z');
});
```

For ULID generation: ULIDs include a timestamp prefix. With fake timers, ULIDs become deterministic too (assuming the random suffix is also seeded — which we'll do in tests via `process.env.MINIH_TEST_DETERMINISTIC_ULID = '1'` that the ULID helper checks).

---

## Test File Layout — Summary

```
test/
├── runner/
│   ├── state.test.ts                            ← Layer 1
│   ├── state-history.test.ts                    ← Layer 1
│   ├── state-schema.test.ts                     ← Layer 1
│   ├── inbox-folder.test.ts                     ← Layer 1
│   ├── inbox-schema.test.ts                     ← Layer 1
│   ├── context.test.ts                          ← Layer 1
│   └── helpers/
│       ├── coordination-fixtures.ts
│       └── tmp-agent.ts
│
├── mcp/                                         ← Layer 2 (NEW DOMAIN)
│   ├── inbox.integration.test.ts
│   ├── state.integration.test.ts
│   ├── transition-gate.integration.test.ts
│   ├── tool-error-envelope.test.ts
│   ├── coexist-with-user-mcp.test.ts
│   └── helpers/
│       ├── test-client.ts
│       └── seed-fixtures.ts
│
├── cli/
│   ├── outside-commands.test.ts                 ← Layer 3a (CLI envelope tests)
│   ├── state-commands.test.ts                   ← Layer 3a
│   └── context-blocking.test.ts                 ← Layer 3a (AC-CTX-BLOCK)
│
└── e2e/                                         ← Layer 3b (opt-in via npm run test:e2e)
    └── mcp-cleanup.test.ts                      ← AC-MCP-CLEAN regression
```

---

## Mapping Tests to ACs

| AC | Layer | Test file |
|----|-------|-----------|
| AC-CTX-DETECT | 1 | `runner/context.test.ts` |
| AC-CTX-BLOCK | 3a | `cli/context-blocking.test.ts` |
| AC-OUTSIDE-SEND | 3a | `cli/outside-commands.test.ts` |
| AC-OUTSIDE-LIST | 3a | `cli/outside-commands.test.ts` |
| AC-INSIDE-LIST | 2 | `mcp/inbox.integration.test.ts` |
| AC-INSIDE-SEND | 2 | `mcp/inbox.integration.test.ts` |
| AC-INSIDE-ACK | 2 | `mcp/inbox.integration.test.ts` |
| AC-STATE-OUTSIDE-WRITE | 3a | `cli/state-commands.test.ts` |
| AC-STATE-INSIDE-READ | 2 | `mcp/state.integration.test.ts` |
| AC-STATE-TRANSITION-GATED | 1 + 2 | `runner/state.test.ts` + `mcp/transition-gate.integration.test.ts` |
| AC-STATE-TRANSITION-OK | 1 + 2 | same |
| AC-MCP-CLEAN | 3b | `e2e/mcp-cleanup.test.ts` |
| AC-MCP-COEXIST | 2 | `mcp/coexist-with-user-mcp.test.ts` |
| AC-BACKWARD-COMPAT | 3a | new `cli/all-existing-agents-pass-doctor.test.ts` |
| AC-RUN-FOLDER | 3a | new `cli/run-folder-snapshot.test.ts` |
| AC-ENV-VARS | 3a | new `cli/env-vars.test.ts` |
| AC-DOMAIN-MAP | manual | reviewer checks `docs/domains/*.md` updated |

Total new test files: ~14. Each is small (50-150 LOC). Total new test LOC: ~1500-2000.

---

## CI Integration

### Fast suite (`npm test`)

Runs Layers 1, 2, 3a. Should complete in <30s. Required for every PR.

### Slow suite (`npm run test:e2e`)

Runs Layer 3b. Requires `GH_TOKEN`. Costs ~$0.05-$0.20 per run. Opt-in:
- Run on every push to `main` (in CI)
- Optional locally
- Can be triggered from PRs via label `e2e-required`

vitest workspace config:

```ts
// vitest.workspace.ts
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  { test: { include: ['test/runner/**', 'test/mcp/**', 'test/cli/**'], name: 'unit' } },
  { test: { include: ['test/e2e/**'], name: 'e2e' } },
]);
```

```json
// package.json scripts
{
  "test":     "vitest run --project unit",
  "test:e2e": "vitest run --project e2e"
}
```

---

## Pgrep Reliability Across CI

`pgrep -f "minih-mcp-"` works on Linux and macOS; Windows CI doesn't support `pgrep`. For Windows, use `tasklist /v | findstr "minih-mcp"` or skip the test (`it.skipIf(process.platform === 'win32')`).

For now: skip on Windows; add a Windows-specific path later if Windows users complain.

---

## Open Questions

### Q1: How to make Layer 3b deterministic enough for flake-free CI?

**OPEN**: real LLM calls have variance. The smoke-test agent should be deterministic enough (hard-coded steps), but model behavior can occasionally regress.
- Mitigation: retry policy (e.g., 3 attempts) on the e2e suite; treat regression as a real bug to investigate.

### Q2: Should we run Layer 3a tests in parallel?

**OPEN**: vitest defaults to sequential; CLI tests do real subprocess work. Could parallelize by giving each test a unique tmp agents dir.
- **Leaning**: parallelize Layer 1+2; keep Layer 3a sequential to avoid subprocess contention.

### Q3: Should we add a `vitest --watch` story for the MCP server?

**OPEN**: developer ergonomics. Spawning the MCP server fresh on every test is slow.
- Could add a `beforeAll` that spawns the server once per file; but per-test isolation is safer.
- **Leaning**: per-test spawn is acceptable; if someone complains about test latency, switch to `beforeAll` per file.

### Q4: How do we test custom transition rules in Layer 2?

**OPEN**: the spawn config doesn't currently pass per-agent rules to the MCP server (workshop 004 Q4). The server reads the run-folder's `prompt.md` for custom rules.
- We'll need a fixture that drops a `prompt.md` with custom rules into the test agent dir before spawning.

### Q5: Should we add a CONTRIBUTING.md section for "how to write tests for coordinated agents"?

**OPEN**: yes, but in plan polish phase, not workshop. Captures the patterns above.

---

## Quick Reference for Test Authors

```ts
// Layer 1 — pure unit
import { isAllowedTransition, DEFAULT_TRANSITIONS } from '../../src/runner/state.js';
const result = isAllowedTransition('inside', 'reviewing', 'complete', { phase: 'done' }, DEFAULT_TRANSITIONS);
expect(result.ok).toBe(true);

// Layer 2 — real MCP server
import { spawnInsideMcp } from './helpers/test-client.js';
const mcp = await spawnInsideMcp({ MINIH_MCP_RUN_ID: '...', /* etc */ });
const result = await mcp.client.callTool({ name: 'inbox.list', arguments: { unread: true } });
await mcp.shutdown();

// Layer 3a — CLI envelope
import { execSync } from 'node:child_process';
const out = execSync(`node dist/cli/index.js outside-send my-agent ...`, { env: { ...process.env, MINIH_AGENTS_DIR: tmpAgents } });
expect(JSON.parse(out.toString()).status).toBe('ok');

// Layer 3b — full-stack with real Copilot (opt-in CI)
const out = execSync(`node dist/cli/index.js run coordination-smoke --model gpt-5.5 --no-reasoning`);
await sleep(5000);
expect(pgrepAll('minih-mcp-')).toEqual([]);
```
