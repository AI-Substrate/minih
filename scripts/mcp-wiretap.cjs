#!/usr/bin/env node

/**
 * MCP Wiretap — proxy that logs all stdin/stdout between SDK and MCP server.
 * Usage: node scripts/mcp-wiretap.js <actual-server-command> [args...]
 * Logs to /tmp/mcp-wiretap.log
 */

const { spawn } = require('child_process');
const fs = require('fs');

const logFile = '/tmp/mcp-wiretap.log';
const args = process.argv.slice(2);
if (args.length === 0) {
  process.stderr.write('Usage: node mcp-wiretap.js <command> [args...]\n');
  process.exit(1);
}

fs.writeFileSync(logFile, `=== MCP Wiretap started: ${new Date().toISOString()} ===\nCommand: ${args.join(' ')}\n\n`);

const child = spawn(args[0], args.slice(1), { stdio: ['pipe', 'pipe', 'pipe'] });

process.stdin.on('data', (chunk) => {
  fs.appendFileSync(logFile, `>>> SDK→Server (${chunk.length} bytes):\n${chunk.toString()}\n---\n`);
  child.stdin.write(chunk);
});

child.stdout.on('data', (chunk) => {
  fs.appendFileSync(logFile, `<<< Server→SDK (${chunk.length} bytes):\n${chunk.toString()}\n---\n`);
  process.stdout.write(chunk);
});

child.stderr.on('data', (chunk) => {
  fs.appendFileSync(logFile, `!!! Server STDERR:\n${chunk.toString()}\n---\n`);
  process.stderr.write(chunk);
});

child.on('exit', (code) => {
  fs.appendFileSync(logFile, `\n=== Server exited with code ${code} ===\n`);
  process.exit(code ?? 0);
});

process.stdin.on('end', () => child.stdin.end());
