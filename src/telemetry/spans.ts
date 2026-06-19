/**
 * Span creation helpers and context propagation utilities.
 *
 * DD5: BaggageCopyProcessor auto-copies minih.* baggage entries to
 * span attributes on onStart() — set once at command entry, every
 * child span inherits automatically.
 */

import {
  type Attributes,
  type Context,
  context,
  propagation,
  ROOT_CONTEXT,
  type Span,
  type SpanContext,
  type SpanOptions,
  SpanStatusCode,
  TraceFlags,
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
 * If parentContext is provided, the span is created as a child of that context
 * (used when the active async context has been broken, e.g. fs.watch callbacks).
 */
export function withSpanSync<T>(
  name: string,
  fn: (span: Span) => T,
  options?: SpanOptions,
  parentContext?: Context,
): T {
  const opts = options ?? {};
  const callback = (span: Span): T => {
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
  };
  if (parentContext) {
    return tracer.startActiveSpan(name, opts, parentContext, callback);
  }
  return tracer.startActiveSpan(name, opts, callback);
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
 * Set attributes on the currently-active span, if any. No-op when there is no
 * recording span (telemetry off or outside any span). Useful for enriching a
 * span created by an outer wrapper (e.g. the MCP dispatch span) from within an
 * inner function without creating a nested span.
 */
export function addSpanAttributes(attributes: Attributes): void {
  trace.getActiveSpan()?.setAttributes(attributes);
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
 * W3C trace context (`traceparent` + `tracestate`) of the active span, for
 * stamping on outbound messages. Uses the global propagator so both keys are
 * captured per W3C Trace Context. Empty object when there is no active span.
 */
export function getTraceContext(): {
  traceparent?: string;
  tracestate?: string;
} {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  const out: { traceparent?: string; tracestate?: string } = {};
  if (carrier.traceparent) out.traceparent = carrier.traceparent;
  if (carrier.tracestate) out.tracestate = carrier.tracestate;
  return out;
}

/**
 * Parse a W3C traceparent string into a remote SpanContext, suitable for use as
 * a span link target (async messaging: link producer↔consumer across processes).
 * Manual parse — does not depend on a globally-registered propagator, so it works
 * even when the OTel SDK is not initialized in the current process.
 * Returns undefined for any malformed input.
 */
export function spanContextFromTraceparent(
  traceparent: string | undefined,
): SpanContext | undefined {
  if (!traceparent) return undefined;
  const match = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/.exec(
    traceparent,
  );
  if (!match) return undefined;
  const [, traceId, spanId, flagsHex] = match;
  if (
    traceId === '00000000000000000000000000000000' ||
    spanId === '0000000000000000'
  ) {
    return undefined;
  }
  const traceFlags =
    Number.parseInt(flagsHex, 16) & TraceFlags.SAMPLED
      ? TraceFlags.SAMPLED
      : TraceFlags.NONE;
  return { traceId, spanId, traceFlags, isRemote: true };
}

/**
 * Build a parent Context from a W3C traceparent string (e.g. a per-call
 * `_meta.traceparent` from an MCP `tools/call`, per SEP-414). Pass the result
 * to `withSpan`/`withSpanSync` so the new span nests under the remote parent
 * (the caller's `execute_tool` span). Returns undefined for malformed input.
 *
 * `tracestate` is accepted for forward-compatibility but not attached to the
 * span context — nesting only needs trace/span ids; the value is preserved on
 * the message envelope instead.
 */
export function contextFromTraceparent(
  traceparent: string | undefined,
  _tracestate?: string,
): Context | undefined {
  const spanContext = spanContextFromTraceparent(traceparent);
  if (!spanContext) return undefined;
  return trace.setSpanContext(ROOT_CONTEXT, spanContext);
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
