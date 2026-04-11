#!/usr/bin/env node

/**
 * minih MCP Test Server — zero-dependency JSON-RPC stdio stub.
 *
 * Exposes two tools:
 *   echo  — returns the input message (proves tools are callable)
 *   add   — returns sum of a + b (proves tool dispatch works)
 *
 * Uses Content-Length framed JSON-RPC (same as vscode-jsonrpc / LSP).
 * Designed as reusable MCP test infrastructure for minih.
 *
 * Usage:
 *   node scripts/mcp-test-server.js          # Start as stdio MCP server
 *   node scripts/mcp-test-server.js --help   # Show help
 */

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stderr.write(`minih MCP Test Server

Zero-dependency JSON-RPC stdio MCP server for testing.

Tools:
  echo   Echo back the input message
  add    Sum two numbers (a + b)

Usage:
  Typically launched by the Copilot SDK via .mcp.json config:
  { "mcpServers": { "test": { "command": "node", "args": ["scripts/mcp-test-server.js"], "tools": ["*"] } } }

Protocol: Content-Length framed JSON-RPC 2.0 over stdio
`);
  process.exit(0);
}

const TOOLS = [
  {
    name: 'echo',
    description: 'Echo back the input message (test tool)',
    inputSchema: {
      type: 'object',
      required: ['message'],
      properties: {
        message: { type: 'string', description: 'Message to echo back' },
      },
    },
  },
  {
    name: 'add',
    description: 'Return the sum of two numbers (test tool)',
    inputSchema: {
      type: 'object',
      required: ['a', 'b'],
      properties: {
        a: { type: 'number', description: 'First number' },
        b: { type: 'number', description: 'Second number' },
      },
    },
  },
];

function handleRequest(req) {
  switch (req.method) {
    case 'initialize':
      return {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'minih-test-mcp', version: '0.1.0' },
      };

    case 'notifications/initialized':
      return null; // notification — no response

    case 'tools/list':
      return { tools: TOOLS };

    case 'tools/call': {
      const toolName = req.params?.name;
      const args = req.params?.arguments ?? {};

      if (toolName === 'echo') {
        const msg = args.message ?? '(no message)';
        return { content: [{ type: 'text', text: msg }] };
      }

      if (toolName === 'add') {
        const a = Number(args.a ?? 0);
        const b = Number(args.b ?? 0);
        return { content: [{ type: 'text', text: String(a + b) }] };
      }

      return {
        content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
        isError: true,
      };
    }

    default:
      return null;
  }
}

// Newline-delimited JSON-RPC (SDK sends raw JSON, one message per chunk)
function sendResponse(id, result) {
  if (result === null || id === undefined) return;
  const body = JSON.stringify({ jsonrpc: '2.0', id, result });
  process.stdout.write(body + '\n');
}

function sendError(id, code, message) {
  const body = JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
  process.stdout.write(body + '\n');
}

let buffer = '';

process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;

  // Process complete JSON messages (may arrive as partial chunks)
  let startIdx = 0;
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === '\n' || i === buffer.length - 1) {
      const line = buffer
        .slice(startIdx, i === buffer.length - 1 ? i + 1 : i)
        .trim();
      startIdx = i + 1;
      if (!line) continue;
      try {
        const req = JSON.parse(line);
        const result = handleRequest(req);
        if (result !== null) {
          sendResponse(req.id, result);
        }
      } catch {
        // Partial message — try as accumulated buffer
      }
    }
  }
  if (startIdx > 0) {
    buffer = buffer.slice(startIdx);
  }

  // Also try parsing the entire buffer as a single message (SDK may send without newline)
  if (buffer.trim()) {
    try {
      const req = JSON.parse(buffer.trim());
      buffer = '';
      const result = handleRequest(req);
      if (result !== null) {
        sendResponse(req.id, result);
      }
    } catch {
      // Incomplete — wait for more data
    }
  }
});

process.stdin.on('end', () => process.exit(0));
