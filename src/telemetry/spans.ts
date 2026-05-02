/**
 * Span creation helpers and context propagation utilities.
 *
 * DD5: BaggageCopyProcessor auto-copies minih.* baggage entries to
 * span attributes on onStart() — set once at command entry, every
 * child span inherits automatically.
 */

import {
  type Context,
  context,
  propagation,
  type Span,
  type SpanOptions,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';
import type {
  ReadableSpan,
  SpanProcessor,
} from '@opentelemetry/sdk-trace-node';

const tracer = trace.getTracer('minih');

/**
 * Start a span with the minih tracer, execute fn within it, and end on completion.
 * Sets span status to ERROR on exception and re-throws.
 * If parentContext is provided, the span is created as a child of that context
 * (used for root spans that should stitch into an external trace via TRACEPARENT).
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  options?: SpanOptions,
  parentContext?: Context,
): Promise<T> {
  const opts = options ?? {};
  const callback = async (span: Span) => {
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
  };
  if (parentContext) {
    return tracer.startActiveSpan(name, opts, parentContext, callback);
  }
  return tracer.startActiveSpan(name, opts, callback);
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
 * Serialize the current active span context as a W3C traceparent string.
 * Returns undefined if there is no active span or the context is invalid.
 * Format: 00-{traceId}-{spanId}-{traceFlags}
 */
export function getTraceparent(): string | undefined {
  const span = trace.getActiveSpan();
  if (!span) return undefined;
  const ctx = span.spanContext();
  if (!ctx.traceId || ctx.traceId === '00000000000000000000000000000000')
    return undefined;
  const flags = ctx.traceFlags.toString(16).padStart(2, '0');
  return `00-${ctx.traceId}-${ctx.spanId}-${flags}`;
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
