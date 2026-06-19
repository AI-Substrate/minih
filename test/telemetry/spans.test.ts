import { describe, expect, it } from 'vitest';
import {
  BaggageCopyProcessor,
  captureContext,
  runInContext,
  setBaggage,
  spanContextFromTraceparent,
  withSpan,
  withSpanSync,
} from '../../src/telemetry/spans.js';

describe('telemetry/spans', () => {
  it('withSpan executes function and returns result', async () => {
    const result = await withSpan('test.span', async () => 42);
    expect(result).toBe(42);
  });

  it('withSpan propagates errors', async () => {
    await expect(
      withSpan('test.span', async () => {
        throw new Error('span error');
      }),
    ).rejects.toThrow('span error');
  });

  it('withSpanSync executes function and returns result', () => {
    const result = withSpanSync('test.span', () => 'hello');
    expect(result).toBe('hello');
  });

  it('withSpanSync propagates errors', () => {
    expect(() =>
      withSpanSync('test.span', () => {
        throw new Error('sync error');
      }),
    ).toThrow('sync error');
  });

  it('withSpanSync accepts an explicit parentContext', () => {
    const parent = captureContext();
    const result = withSpanSync('test.span', () => 'rooted', undefined, parent);
    expect(result).toBe('rooted');
  });

  it('setBaggage returns a context', () => {
    const ctx = setBaggage({ 'minih.test': 'value' });
    expect(ctx).toBeDefined();
  });

  it('captureContext returns current context', () => {
    const ctx = captureContext();
    expect(ctx).toBeDefined();
  });

  it('runInContext executes function in given context', () => {
    const ctx = captureContext();
    const result = runInContext(ctx, () => 'in-context');
    expect(result).toBe('in-context');
  });

  it('BaggageCopyProcessor implements SpanProcessor interface', () => {
    const processor = new BaggageCopyProcessor();
    expect(typeof processor.onStart).toBe('function');
    expect(typeof processor.onEnd).toBe('function');
    expect(typeof processor.shutdown).toBe('function');
    expect(typeof processor.forceFlush).toBe('function');
  });

  describe('spanContextFromTraceparent', () => {
    it('parses a valid sampled traceparent into a remote SpanContext', () => {
      const sc = spanContextFromTraceparent(
        '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      );
      expect(sc).toEqual({
        traceId: '0af7651916cd43dd8448eb211c80319c',
        spanId: 'b7ad6b7169203331',
        traceFlags: 1,
        isRemote: true,
      });
    });

    it('parses an unsampled traceparent (flags 00)', () => {
      const sc = spanContextFromTraceparent(
        '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-00',
      );
      expect(sc?.traceFlags).toBe(0);
    });

    it('returns undefined for undefined input', () => {
      expect(spanContextFromTraceparent(undefined)).toBeUndefined();
    });

    it('returns undefined for malformed input', () => {
      expect(spanContextFromTraceparent('not-a-traceparent')).toBeUndefined();
      expect(spanContextFromTraceparent('00-tooshort-x-01')).toBeUndefined();
    });

    it('returns undefined for all-zero trace or span ids', () => {
      expect(
        spanContextFromTraceparent(
          '00-00000000000000000000000000000000-b7ad6b7169203331-01',
        ),
      ).toBeUndefined();
      expect(
        spanContextFromTraceparent(
          '00-0af7651916cd43dd8448eb211c80319c-0000000000000000-01',
        ),
      ).toBeUndefined();
    });
  });
});
