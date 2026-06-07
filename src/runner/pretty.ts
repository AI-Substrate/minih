/**
 * Pretty display — clean streaming output for agent execution.
 *
 * Thinking text streams in gray italic. Normal text in white.
 * Tool calls formatted with name + preview. Intent shown inline.
 * Designed for clean terminal scrolling (no TUI, no cursor tricks).
 *
 * Outputs to stderr (stdout reserved for JSON envelope).
 */

import chalk from 'chalk';
import type { AgentEvent } from '../adapter/events.js';

export class PrettyDisplay {
  private inDeltaStream = false;
  private lastDeltaMessageId: string | undefined;
  private inThinkingStream = false;
  private sawThinkingDelta = false;
  private currentIntent: string | undefined;
  private pendingTools = new Map<string, string>();
  private toolTimers = new Map<
    string,
    { timer: ReturnType<typeof setInterval>; line: string; start: number }
  >();

  handleEvent(event: AgentEvent): void {
    switch (event.type) {
      case 'thinking':
        this.handleThinking(event);
        break;
      case 'text_delta':
        this.handleTextDelta(event);
        break;
      case 'message':
        this.handleMessage(event);
        break;
      case 'tool_call':
        this.handleToolCall(event);
        break;
      case 'tool_result':
        this.handleToolResult(event);
        break;
      case 'session_error':
        this.endStreams();
        process.stderr.write(
          `\n${chalk.red(`  ❌ ${event.data.message ?? 'Session error'}`)}\n`,
        );
        break;
      case 'skills_loaded':
        this.endStreams();
        process.stderr.write(
          `  ${chalk.cyan('🧩')} skills loaded: ${event.data.skills.map((skill) => skill.name).join(', ') || 'none'}\n`,
        );
        break;
      case 'skill_invoked':
        this.endStreams();
        process.stderr.write(
          `  ${chalk.cyan('🧩')} skill invoked: ${event.data.name}\n`,
        );
        break;
      case 'usage':
      case 'session_idle':
      case 'session_start':
      case 'raw':
      case 'user_prompt':
        break;
    }
  }

  cleanup(): void {
    this.endStreams();
    for (const entry of this.toolTimers.values()) {
      clearInterval(entry.timer);
    }
    this.toolTimers.clear();
  }

  private handleThinking(
    event: Extract<AgentEvent, { type: 'thinking' }>,
  ): void {
    // Suppress final consolidated thinking when deltas already streamed
    if (event.data.isDelta === false) {
      if (this.sawThinkingDelta) return;
      // Final-only thinking (no prior deltas) — show it
      this.endStreams();
      process.stderr.write(chalk.gray.italic(event.data.content));
      process.stderr.write('\n');
      return;
    }

    this.sawThinkingDelta = true;

    // End any text delta stream before starting thinking
    if (this.inDeltaStream) {
      process.stderr.write('\n');
      this.inDeltaStream = false;
    }

    if (!this.inThinkingStream) {
      this.inThinkingStream = true;
    }

    // Stream thinking content in gray italic
    process.stderr.write(chalk.gray.italic(event.data.content));
  }

  private handleTextDelta(
    event: Extract<AgentEvent, { type: 'text_delta' }>,
  ): void {
    // End thinking stream
    if (this.inThinkingStream) {
      process.stderr.write('\n');
      this.inThinkingStream = false;
    }

    if (!this.inDeltaStream) {
      this.inDeltaStream = true;
    }
    this.lastDeltaMessageId = event.data.messageId;

    process.stderr.write(event.data.content);
  }

  private handleMessage(event: Extract<AgentEvent, { type: 'message' }>): void {
    // Suppress if we've been streaming deltas (content already shown)
    if (this.inDeltaStream) {
      process.stderr.write('\n');
      this.inDeltaStream = false;
      this.lastDeltaMessageId = undefined;
      return;
    }
    if (
      this.lastDeltaMessageId &&
      event.data.messageId === this.lastDeltaMessageId
    ) {
      this.lastDeltaMessageId = undefined;
      return;
    }

    // No prior deltas — show the message
    this.endStreams();
    process.stderr.write(`${event.data.content}\n`);
  }

  private handleToolCall(
    event: Extract<AgentEvent, { type: 'tool_call' }>,
  ): void {
    this.endStreams();

    // Capture report_intent
    if (event.data.toolName === 'report_intent') {
      const input = event.data.input as Record<string, unknown> | undefined;
      const intent =
        typeof input?.intent === 'string' ? input.intent : undefined;
      if (intent && intent !== this.currentIntent) {
        this.currentIntent = intent;
        process.stderr.write(`\n  ${chalk.cyan('▸')} ${chalk.bold(intent)}\n`);
      }
      return;
    }

    // Format tool call
    const input = event.data.input;
    let preview = '';
    if (typeof input === 'string') {
      preview = input;
    } else if (typeof input === 'object' && input !== null) {
      const rec = input as Record<string, unknown>;
      preview = String(
        rec.command ?? rec.description ?? rec.path ?? rec.query ?? '',
      );
    }
    const cols = process.stderr.columns ?? 80;
    const truncated = preview.slice(0, cols - 20).split('\n')[0];
    const toolLine = `  ${chalk.magenta('🔧')} ${chalk.magenta(event.data.toolName)}  ${chalk.dim(truncated)}`;
    process.stderr.write(`${toolLine}\n`);
    this.pendingTools.set(event.data.toolCallId, event.data.toolName);

    // Start elapsed timer for long-running tools
    const startTime = Date.now();
    const timer = setInterval(() => {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      process.stderr.write(`\r${toolLine}  ${chalk.dim(`${elapsed}s...`)}`);
    }, 5000);
    this.toolTimers.set(event.data.toolCallId, {
      timer,
      line: toolLine,
      start: startTime,
    });
  }

  private handleToolResult(
    event: Extract<AgentEvent, { type: 'tool_result' }>,
  ): void {
    const toolName = this.pendingTools.get(event.data.toolCallId);
    this.pendingTools.delete(event.data.toolCallId);

    // Clear elapsed timer
    const timerEntry = this.toolTimers.get(event.data.toolCallId);
    if (timerEntry) {
      clearInterval(timerEntry.timer);
      this.toolTimers.delete(event.data.toolCallId);
      // Clear the timer line if it was showing elapsed
      if (Date.now() - timerEntry.start >= 5000) {
        process.stderr.write(`\r${' '.repeat(process.stderr.columns ?? 80)}\r`);
      }
    }

    if (!toolName) return;

    const icon = event.data.isError ? chalk.red('✗') : chalk.green('✓');
    const cols = process.stderr.columns ?? 80;
    const output = event.data.output
      .slice(0, cols - 20)
      .split('\n')[0]
      .trim();
    if (output) {
      process.stderr.write(`     ${icon} ${chalk.dim(output)}\n`);
    } else {
      process.stderr.write(`     ${icon}\n`);
    }
  }

  private endStreams(): void {
    if (this.inThinkingStream) {
      process.stderr.write('\n');
      this.inThinkingStream = false;
      this.sawThinkingDelta = false;
    }
    if (this.inDeltaStream) {
      process.stderr.write('\n');
      this.inDeltaStream = false;
    }
  }
}
