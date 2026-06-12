/**
 * withDeadline — bound an SDK await so cleanup can never hang.
 *
 * Plan 026 (stall watchdog): no code path between a kill trigger and the
 * terminal artifact writes may await an unbounded SDK promise. The SDK
 * exposes no AbortSignal, so on expiry the losing promise is left to
 * settle (or not) in the background — its eventual rejection is swallowed
 * to avoid an unhandled rejection from a subprocess we are about to
 * force-stop anyway.
 */

export const DEADLINE_EXPIRED: unique symbol = Symbol('deadline-expired');
export type DeadlineExpired = typeof DEADLINE_EXPIRED;

export function withDeadline<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout?: () => void,
): Promise<T | DeadlineExpired> {
  return new Promise<T | DeadlineExpired>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      // Detach: a late rejection must not surface as unhandled.
      promise.catch(() => {});
      try {
        onTimeout?.();
      } catch {
        // onTimeout is best-effort — it never breaks the bound.
      }
      resolve(DEADLINE_EXPIRED);
    }, ms);
    // The deadline alone must not keep the process alive.
    timer.unref?.();
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
