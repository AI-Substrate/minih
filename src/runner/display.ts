/**
 * Agent display — rich terminal output for agent execution.
 *
 * Outputs to stderr (stdout reserved for JSON envelope).
 * Provides header box, real-time event streaming, and completion summary.
 *
 * Extracted from: harness/src/agent/display.ts
 */

import type { AgentEvent } from '../adapter/events.js';
import type { AgentRunResult, CompletedMetadata } from './types.js';

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

export function displayHeader(slug: string, runId: string, model?: string): void {
  const line = '─'.repeat(50);
  process.stderr.write(`\n${c.bold}╭${line}╮${c.reset}\n`);
  process.stderr.write(`${c.bold}│  Agent: ${c.cyan}${slug}${c.reset}${' '.repeat(Math.max(0, 40 - slug.length))}│${c.reset}\n`);
  process.stderr.write(`${c.bold}│  Run:   ${c.dim}${runId.slice(0, 38)}${c.reset}${' '.repeat(Math.max(0, 40 - Math.min(runId.length, 38)))}│${c.reset}\n`);
  if (model) {
    process.stderr.write(`${c.bold}│  Model: ${c.yellow}${model}${c.reset}${' '.repeat(Math.max(0, 40 - model.length))}│${c.reset}\n`);
  }
  process.stderr.write(`${c.bold}╰${line}╯${c.reset}\n\n`);
}

export function displayPreflight(label: string, ok: boolean, detail?: string): void {
  const icon = ok ? `${c.green}✓` : `${c.red}✗`;
  const msg = detail ? ` ${c.dim}(${detail})${c.reset}` : '';
  process.stderr.write(`  ${icon}${c.reset} ${label}${msg}\n`);
}

export function formatEvent(event: AgentEvent): string {
  switch (event.type) {
    case 'text_delta':
      return `${c.cyan}[${ts()}]${c.reset} ${c.dim}${event.data.content}${c.reset}`;
    case 'message':
      return `${c.cyan}[${ts()}]${c.reset} 📝 ${c.dim}(${event.data.content.length} chars)${c.reset}`;
    case 'thinking':
      return `${c.cyan}[${ts()}]${c.reset} 💭 ${c.dim}${event.data.content.slice(0, 80)}${c.reset}`;
    case 'tool_call': {
      const input = event.data.input;
      const preview = typeof input === 'string' ? input
        : typeof input === 'object' && input !== null
          ? (input as Record<string, unknown>).command ?? (input as Record<string, unknown>).description ?? JSON.stringify(input)
          : String(input);
      return `${c.cyan}[${ts()}]${c.reset} 🔧 ${c.magenta}${event.data.toolName}${c.reset} ${c.dim}${String(preview).slice(0, 100)}${c.reset}`;
    }
    case 'tool_result':
      return `${c.cyan}[${ts()}]${c.reset}    ${event.data.isError ? `${c.red}✗` : `${c.green}✓`}${c.reset} ${c.dim}${event.data.output.slice(0, 80)}${c.reset}`;
    case 'usage':
      return `${c.cyan}[${ts()}]${c.reset} 📊 tokens: in=${event.data.inputTokens ?? '?'} out=${event.data.outputTokens ?? '?'}`;
    case 'session_idle':
      return `${c.cyan}[${ts()}]${c.reset} ⏸  session idle`;
    case 'session_error':
      return `${c.cyan}[${ts()}]${c.reset} ${c.red}❌ ${event.data.message}${c.reset}`;
    default:
      return `${c.cyan}[${ts()}]${c.reset} ${c.dim}${event.type}${c.reset}`;
  }
}

export function displayEvent(event: AgentEvent): void {
  if (event.type === 'raw' || event.type === 'session_start') return;
  process.stderr.write(`${formatEvent(event)}\n`);
}

export function displaySummary(result: AgentRunResult): void {
  const { metadata, validation, runDir } = result;
  const statusColor = metadata.result === 'completed' ? c.green
    : metadata.result === 'degraded' ? c.yellow
    : c.red;
  const durationSec = (metadata.durationMs / 1000).toFixed(1);

  process.stderr.write(`\n${c.bold}─── Summary ───${c.reset}\n`);
  process.stderr.write(`  Status:     ${statusColor}${metadata.result}${c.reset}\n`);
  process.stderr.write(`  Duration:   ${durationSec}s\n`);
  process.stderr.write(`  Session:    ${c.dim}${metadata.sessionId || 'N/A'}${c.reset}\n`);
  process.stderr.write(`  Events:     ${metadata.eventCount} (${metadata.toolCallCount} tool calls)\n`);

  if (validation) {
    const vIcon = validation.valid ? `${c.green}✓ passed` : `${c.red}✗ failed`;
    process.stderr.write(`  Validation: ${vIcon}${c.reset}\n`);
    if (!validation.valid) {
      for (const err of validation.errors.slice(0, 5)) {
        process.stderr.write(`    ${c.red}· ${err}${c.reset}\n`);
      }
    }
  }

  process.stderr.write(`  Run dir:    ${c.dim}${runDir}${c.reset}\n`);
  process.stderr.write(`  Artifacts:  ${metadata.artifacts.join(', ')}\n`);
}
