/**
 * Span creation helpers and context propagation utilities.
 *
 * DD5: BaggageCopyProcessor auto-copies minih.* baggage entries to
 * span attributes on onStart() — set once at command entry, every
 * child span inherits automatically.
 */

import {
  type Span,
  type Context,
  type SpanOptions,
  trace,
  context,
  propagation,
  SpanStatusCode,
} from '@opentelemetry/api';
import type {
  SpanProcessor,
  ReadableSpan,
} from '@opentelemetry/sdk-trace-node';

const tracer = trace.getTracer('minih');

/**
 * Start a span with the minih tracer, execute fn within it, and end on completion.
 * Sets span status to ERROR on exception and re-throws.
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  options?: SpanOptions,
): Promise<T> {
  return tracer.startActiveSpan(name, options ?? {}, async (span) => {
    try {
      const result = await fn(span);
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Start a synchronous span with the minih tracer.
 */
export function withSpanSync<T>(
  name: string,
  fn: (span: Span) => T,
  options?: SpanOptions,
): T {
  return tracer.startActiveSpan(name, options ?? {}, (span) => {
    try {
      const result = fn(span);
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Set minih baggage values on the current context.
 * These propagate to all child spans via BaggageCopyProcessor (DD5).
 */
export function setBaggage(entries: Record<string, string>): Context {
  let baggage =
    propagation.getBaggage(context.active()) ?? propagation.createBaggage();
  for (const [key, value] of Object.entries(entries)) {
    baggage = baggage.setEntry(key, { value });
  }
  return propagation.setBaggage(context.active(), baggage);
}

/**
 * Capture the current active context for use in a callback that breaks
 * the async context chain (e.g., SDK event handlers).
 */
export function captureContext(): Context {
  return context.active();
}

/**
 * Execute a function within a previously captured context.
 * Use this inside callbacks that break the async context chain.
 */
export function runInContext<T>(ctx: Context, fn: () => T): T {
  return context.with(ctx, fn);
}

/**
 * BaggageCopyProcessor — auto-copies minih.* baggage entries
 * to span attributes on span start (DD5).
 *
 * Set baggage once at root (e.g., minih.agent.slug, minih.run.id),
 * and every descendant span gets those attributes automatically.
 */
export class BaggageCopyProcessor implements SpanProcessor {
  onStart(span: Span, parentContext: Context): void {
    const baggage = propagation.getBaggage(parentContext);
    if (!baggage) return;
    for (const [key, entry] of baggage.getAllEntries()) {
      if (key.startsWith('minih.')) {
        span.setAttribute(key, entry.value);
      }
    }
  }

  onEnd(_span: ReadableSpan): void {
    // no-op
  }

  async shutdown(): Promise<void> {
    // no-op
  }

  async forceFlush(): Promise<void> {
    // no-op
  }
}
