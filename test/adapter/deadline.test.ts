import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEADLINE_EXPIRED, withDeadline } from '../../src/adapter/deadline.js';

// Plan 026 T002 — withDeadline bounds SDK awaits so cleanup can never hang.
describe('withDeadline', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes through a resolution that beats the deadline', async () => {
    await expect(withDeadline(Promise.resolve('value'), 1000)).resolves.toBe(
      'value',
    );
  });

  it('passes through a rejection that beats the deadline', async () => {
    const boom = new Error('boom');
    await expect(withDeadline(Promise.reject(boom), 1000)).rejects.toBe(boom);
  });

  it('clears its timer once the promise settles (leak-free)', async () => {
    vi.useFakeTimers();
    await withDeadline(Promise.resolve('done'), 5000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resolves to the DEADLINE_EXPIRED sentinel when the deadline fires first', async () => {
    vi.useFakeTimers();
    const never = new Promise<never>(() => {});
    const bounded = withDeadline(never, 50);
    vi.advanceTimersByTime(50);
    await expect(bounded).resolves.toBe(DEADLINE_EXPIRED);
  });

  it('invokes onTimeout exactly once on expiry', async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const bounded = withDeadline(new Promise<never>(() => {}), 50, onTimeout);
    vi.advanceTimersByTime(200);
    await bounded;
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('does not invoke onTimeout when the promise settles in time', async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    await withDeadline(Promise.resolve('ok'), 50, onTimeout);
    vi.advanceTimersByTime(200);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('never throws raw on expiry — a late rejection is swallowed', async () => {
    let rejectLate: (err: Error) => void = () => {};
    const late = new Promise<never>((_, reject) => {
      rejectLate = reject;
    });
    const result = await withDeadline(late, 10);
    expect(result).toBe(DEADLINE_EXPIRED);
    rejectLate(new Error('late boom'));
    // A surfaced unhandled rejection would fail the vitest run.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
