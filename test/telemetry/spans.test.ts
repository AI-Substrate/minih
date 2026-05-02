import { describe, it, expect } from 'vitest';
import {
  withSpan,
  withSpanSync,
  setBaggage,
  captureContext,
  runInContext,
  BaggageCopyProcessor,
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
});
