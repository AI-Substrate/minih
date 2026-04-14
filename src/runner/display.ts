/**
 * Agent display — rich terminal output for agent execution.
 *
 * Outputs to stderr (stdout reserved for JSON envelope).
 * Uses chalk for color handling (graceful non-TTY degradation).
 */

import chalk from 'chalk';
import type { AgentEvent } from '../adapter/events.js';
import type { AgentRunResult } from './types.js';

function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

export function displayHeader(
  slug: string,
  runId: string,
  model?: string,
): void {
  const line = '─'.repeat(50);
  process.stderr.write(`\n${chalk.bold(`╭${line}╮`)}\n`);
  process.stderr.write(
    `${chalk.bold('│')}  Agent: ${chalk.cyan(slug)}${' '.repeat(Math.max(0, 40 - slug.length))}${chalk.bold('│')}\n`,
  );
  process.stderr.write(
    `${chalk.bold('│')}  Run:   ${chalk.dim(runId.slice(0, 38))}${' '.repeat(Math.max(0, 40 - Math.min(runId.length, 38)))}${chalk.bold('│')}\n`,
  );
  if (model) {
    process.stderr.write(
      `${chalk.bold('│')}  Model: ${chalk.yellow(model)}${' '.repeat(Math.max(0, 40 - model.length))}${chalk.bold('│')}\n`,
    );
  }
  process.stderr.write(`${chalk.bold(`╰${line}╯`)}\n\n`);
}

export function displayPreflight(
  label: string,
  ok: boolean,
  detail?: string,
): void {
  const icon = ok ? chalk.green('✓') : chalk.red('✗');
  const msg = detail ? ` ${chalk.dim(`(${detail})`)}` : '';
  process.stderr.write(`  ${icon} ${label}${msg}\n`);
}

export function formatEvent(event: AgentEvent): string {
  const t = chalk.cyan(`[${ts()}]`);
  switch (event.type) {
    case 'text_delta':
      return `${t} ${chalk.dim(event.data.content)}`;
    case 'message':
      return `${t} 📝 ${chalk.dim(`(${event.data.content.length} chars)`)}`;
    case 'thinking':
      return `${t} 💭 ${chalk.dim(event.data.content.slice(0, 80))}`;
    case 'tool_call': {
      const input = event.data.input;
      const preview =
        typeof input === 'string'
          ? input
          : typeof input === 'object' && input !== null
            ? ((input as Record<string, unknown>).command ??
              (input as Record<string, unknown>).description ??
              JSON.stringify(input))
            : String(input);
      return `${t} 🔧 ${chalk.magenta(event.data.toolName)} ${chalk.dim(String(preview).slice(0, 100))}`;
    }
    case 'tool_result':
      return `${t}    ${event.data.isError ? chalk.red('✗') : chalk.green('✓')} ${chalk.dim(event.data.output.slice(0, 80))}`;
    case 'usage':
      return `${t} 📊 tokens: in=${event.data.inputTokens ?? '?'} out=${event.data.outputTokens ?? '?'}`;
    case 'session_idle':
      return `${t} ⏸  session idle`;
    case 'session_error':
      return `${t} ${chalk.red(`❌ ${event.data.message}`)}`;
    default:
      return `${t} ${chalk.dim(event.type)}`;
  }
}

export function displayEvent(event: AgentEvent): void {
  if (event.type === 'raw' || event.type === 'session_start') return;
  process.stderr.write(`${formatEvent(event)}\n`);
}

export function displaySummary(result: AgentRunResult): void {
  const { metadata, validation, runDir, parsedReport } = result;
  const statusColor =
    metadata.result === 'completed'
      ? chalk.green
      : metadata.result === 'degraded'
        ? chalk.yellow
        : chalk.red;
  const durationSec = (metadata.durationMs / 1000).toFixed(1);

  process.stderr.write(`\n${chalk.bold('─── Summary ───')}\n`);
  process.stderr.write(`  Status:     ${statusColor(metadata.result)}\n`);
  process.stderr.write(`  Duration:   ${durationSec}s\n`);
  process.stderr.write(
    `  Session:    ${chalk.dim(metadata.sessionId || 'N/A')}\n`,
  );
  process.stderr.write(
    `  Events:     ${metadata.eventCount} (${metadata.toolCallCount} tool calls)\n`,
  );

  if (validation) {
    const vIcon = validation.valid
      ? chalk.green('✓ passed')
      : chalk.red('✗ failed');
    process.stderr.write(`  Validation: ${vIcon}\n`);
    if (!validation.valid) {
      for (const err of validation.errors.slice(0, 5)) {
        process.stderr.write(`    ${chalk.red('·')} ${err}\n`);
      }
    }
  }

  if (metadata.velocity) {
    const v = metadata.velocity;
    const arrow =
      v.changePercent === null
        ? chalk.dim('—')
        : v.changePercent < -5
          ? chalk.green(`▼ ${Math.abs(v.changePercent)}%`)
          : v.changePercent > 5
            ? chalk.red(`▲ ${v.changePercent}%`)
            : chalk.dim('—');
    process.stderr.write(`  Velocity:   run #${v.runNumber} ${arrow}\n`);
  }

  if (parsedReport?.magicWand) {
    process.stderr.write(
      `  ${chalk.magenta('🪄 Magic wand')}: ${parsedReport.magicWand.slice(0, 120)}${parsedReport.magicWand.length > 120 ? '...' : ''}\n`,
    );
  }

  if (parsedReport?.difficulties && parsedReport.difficulties.length > 0) {
    const count = parsedReport.difficulties.length;
    const blocking = parsedReport.difficulties.filter(
      (d) => d.severity === 'blocking',
    ).length;
    const label =
      blocking > 0
        ? chalk.red(`${count} (${blocking} blocking)`)
        : chalk.yellow(`${count}`);
    process.stderr.write(`  Difficulties: ${label}\n`);
  }

  process.stderr.write(`  Run dir:    ${chalk.dim(runDir)}\n`);
  process.stderr.write(`  Artifacts:  ${metadata.artifacts.join(', ')}\n`);
}
