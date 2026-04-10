# Workshop: MCP Testing & Validation Strategy

**Type**: Integration Pattern
**Plan**: 005-mcp-config
**Spec**: [mcp-config-spec.md](../mcp-config-spec.md)
**Created**: 2026-04-10
**Status**: Draft

**Related Documents**:
- [Research Dossier](../research-dossier.md)

**Domain Context**:
- **Primary Domain**: adapter (SDK session config)
- **Related Domains**: runner (config threading), cli (flags)

---

## Purpose

Design how we validate MCP config support works end-to-end: what test MCP server to use, what fixtures to ship, what dogfood agent to create, and how to verify in CI. This ensures the feature is testable from day one and provides a reusable MCP test infrastructure for future work.

## Key Questions Addressed

- What MCP server do we test against?
- Do we create a new dogfood agent?
- What goes in the test `.mcp.json` fixture?
- How do we validate MCP tools are actually available to agents?
- Can we test this in CI (no external services)?

---

## Test MCP Server: Ship a Stub

### Why a stub, not a real server

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| In-repo Node.js stub | Zero deps, deterministic, version-controlled, works in CI | Must implement MCP protocol | ✅ **Chosen** |
| `@modelcontextprotocol/server-filesystem` | Official, battle-tested | External dep, does real I/O, non-deterministic | ❌ Too heavy |
| Inline `node -e` in .mcp.json | No file to maintain | Unmaintainable, hard to debug | ❌ Fragile |

### The Stub: `scripts/mcp-test-server.js`

A ~50 line Node.js script that speaks MCP protocol (JSON-RPC over stdio). Exposes one tool: `echo` — accepts a `message` string, returns it back. Enough to prove MCP servers load and tools are callable.

```javascript
#!/usr/bin/env node

// Minimal MCP test server — JSON-RPC over stdio
// Exposes one tool: "echo" — returns the input message
// Used by minih's MCP integration tests and dogfood agents

const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin });

function send(msg) {
  const json = JSON.stringify(msg);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
}

function handleRequest(req) {
  switch (req.method) {
    case 'initialize':
      return {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'minih-test-mcp', version: '0.1.0' }
      };

    case 'tools/list':
      return {
        tools: [{
          name: 'echo',
          description: 'Echo back the input message (test tool)',
          inputSchema: {
            type: 'object',
            required: ['message'],
            properties: {
              message: { type: 'string', description: 'Message to echo' }
            }
          }
        }]
      };

    case 'tools/call':
      const msg = req.params?.arguments?.message ?? '(no message)';
      return { content: [{ type: 'text', text: msg }] };

    case 'notifications/initialized':
      return null; // notification, no response

    default:
      return { error: { code: -32601, message: `Unknown method: ${req.method}` } };
  }
}

let buffer = '';

rl.on('line', (line) => {
  buffer += line + '\n';
  // Simple: try to parse complete JSON-RPC messages
  try {
    const match = buffer.match(/\{[\s\S]*\}/);
    if (match) {
      const req = JSON.parse(match[0]);
      buffer = '';
      const result = handleRequest(req);
      if (result !== null) {
        send({ jsonrpc: '2.0', id: req.id, result });
      }
    }
  } catch { /* accumulate more */ }
});
```

### Why `echo` is the right test tool

- **Deterministic**: Same input → same output. No filesystem, no network, no state.
- **Proves the full chain**: Tool listed → tool called → result returned.
- **Easy to verify**: Agent calls `echo` with a message, checks it comes back.
- **Minimal protocol surface**: Only `initialize`, `tools/list`, `tools/call` needed.

---

## Test Fixture: `.mcp.json`

Lives at **project root** for auto-discovery tests, and as a **test fixture** for unit tests.

### agents/_testing/.mcp.json (dogfood agent testing)

```json
{
  "mcpServers": {
    "test-echo": {
      "command": "node",
      "args": ["scripts/mcp-test-server.js"],
      "tools": ["*"]
    }
  }
}
```

### test/fixtures/mcp-config.json (unit tests)

```json
{
  "mcpServers": {
    "test-echo": {
      "command": "node",
      "args": ["../../scripts/mcp-test-server.js"],
      "tools": ["*"]
    }
  }
}
```

**Note**: Paths are relative to where the SDK spawns the process — which is `workingDirectory` (the run folder). The stub path may need to be absolute or resolved by the runner before forwarding.

---

## Dogfood Agent: `mcp-smoke-test`

### Purpose

Validates that MCP tools are available in minih sessions. Quick, focused, deterministic.

### Folder Structure

```
agents/mcp-smoke-test/
├── prompt.md
├── output-schema.json
└── input-schema.json (optional — maybe a "server_name" param)
```

### prompt.md

```markdown
---
description: Validate MCP tools are available in minih agent sessions
tags: [smoke, mcp, integration]
timeout: 300
---

# MCP Smoke Test

Verify that MCP servers defined in the project config are loaded and
their tools are callable.

## Steps

1. cd $MINIH_PROJECT_ROOT
2. Check if .mcp.json exists at the project root
3. List available tools — look for the "echo" tool from test-echo server
4. Call the echo tool with a test message
5. Verify the response matches the input
6. Report pass/fail for each step
```

### output-schema.json

```json
{
  "type": "object",
  "required": ["mcpAvailable", "toolsFound", "echoTestPassed", "summary", "retrospective"],
  "properties": {
    "mcpAvailable": { "type": "boolean" },
    "toolsFound": {
      "type": "array",
      "items": { "type": "string" }
    },
    "echoTestPassed": { "type": "boolean" },
    "echoInput": { "type": "string" },
    "echoOutput": { "type": "string" },
    "summary": { "type": "string", "minLength": 20 },
    "retrospective": {
      "type": "object",
      "required": ["workedWell", "confusing", "magicWand"],
      "additionalProperties": true,
      "properties": {
        "workedWell": { "type": "string", "minLength": 10 },
        "confusing": { "type": "string", "minLength": 10 },
        "magicWand": { "type": "string", "minLength": 20 }
      }
    }
  }
}
```

### How it validates

The agent doesn't just check types — it **calls the tool and verifies the response**:

```
1. .mcp.json exists?              → mcpAvailable: true/false
2. "echo" tool in available tools? → toolsFound: ["echo", ...]
3. Call echo("hello from minih")   → echoOutput === "hello from minih"?
4. echoTestPassed: true/false
```

If MCP config forwarding works, the agent sees `echo` in its tool list and can call it. If it doesn't work, `toolsFound` will be empty and `echoTestPassed` will be false — clear signal.

---

## Unit Tests (Lightweight)

### What to test in vitest

```typescript
// test/runner/mcp.test.ts

describe('MCP config threading', () => {
  it('passes configDir through to adapter', async () => {
    const adapter = new FakeAgentAdapter();
    // ... run agent with configDir set
    // Verify adapter.run() received configDir in options
  });

  it('loads and parses --mcp-config file', () => {
    const config = loadMcpConfig('test/fixtures/mcp-config.json');
    expect(config.mcpServers).toHaveProperty('test-echo');
    expect(config.mcpServers['test-echo'].command).toBe('node');
  });

  it('defaults configDir to project root when no --mcp-config', () => {
    // Verify that when no explicit config is given,
    // configDir is set to config.cwd (project root)
  });

  it('skips MCP when no config exists', () => {
    // Verify no configDir or mcpServers are set
    // when project has no .mcp.json
  });
});
```

### What NOT to test in vitest

- Actual MCP server startup (SDK responsibility)
- MCP protocol handling (our stub is test infra, not production code)
- Tool call results (that's the dogfood agent's job)

---

## CI Considerations

### Can we run the MCP smoke-test agent in CI?

**No** — it requires `GH_TOKEN` and a copilot SDK session. But the unit tests CAN run in CI:

```yaml
# In ci.yml quality-gate job (already exists)
- name: Test (vitest)
  run: npm test   # Includes new MCP threading tests
```

### Can we validate the stub server works in CI?

**Yes** — the stub is pure Node.js, no deps:

```yaml
- name: Verify MCP test server
  run: |
    echo '{"jsonrpc":"2.0","id":1,"method":"initialize"}' | node scripts/mcp-test-server.js &
    # or just validate it starts without error
    timeout 5 node -e "
      const { spawn } = require('child_process');
      const p = spawn('node', ['scripts/mcp-test-server.js']);
      setTimeout(() => { p.kill(); process.exit(0); }, 2000);
    "
```

---

## Implementation Checklist

| # | Artifact | Purpose |
|---|----------|---------|
| 1 | `scripts/mcp-test-server.js` | Zero-dep MCP stub (echo tool) |
| 2 | `test/fixtures/mcp-config.json` | Unit test fixture |
| 3 | `agents/mcp-smoke-test/prompt.md` | Dogfood agent for E2E validation |
| 4 | `agents/mcp-smoke-test/output-schema.json` | Structured pass/fail output |
| 5 | `test/runner/mcp.test.ts` | Unit tests for config threading |
| 6 | `.mcp.json` at project root (optional) | Enable auto-discovery testing locally |

---

## Open Questions

### Q1: Should `.mcp.json` be committed to the repo?

**RESOLVED**: Yes, but only for local testing. Add a comment explaining it's the test MCP config. CI doesn't use it (no agent runs in CI).

### Q2: Should the stub server handle Content-Length headers properly?

**RESOLVED**: Start simple (line-based parsing). If the SDK expects proper HTTP-style framing, upgrade to Content-Length parsing. Test empirically.

### Q3: Should we add `mcp-smoke-test` to `minih doctor`?

**OPEN**: Probably not — doctor checks conventions, not runtime behavior. The smoke test is a run-time validation, not a static check.

---

## Future Extensions

- **More test tools**: Add tools beyond `echo` (e.g., `add` for arithmetic, `fail` for error handling tests)
- **Remote MCP server**: HTTP/SSE test server for testing remote MCP config
- **MCP health in `minih doctor`**: Check that configured MCP servers can start
- **MCP tool inventory in `minih inspect`**: Show which MCP tools an agent would have access to
