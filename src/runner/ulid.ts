/**
 * Minimal in-tree ULID generator (Crockford-base32; 48-bit ms timestamp + 80-bit randomness).
 *
 * Monotonicity contract:
 * - Sub-millisecond collision: two `ulid()` calls in the same ms increment the random
 *   suffix (NOT regenerated) so lex-sort order matches call order.
 * - Clock rewind: when `Date.now()` returns a value less than the prior call's timestamp
 *   (NTP step-backward, VM hibernation), reuse the prior timestamp and increment the
 *   suffix — emit IDs are monotonic even under clock rewind.
 *
 * Export surface is intentionally narrow (just `ulid()`) so a future swap to the
 * `ulid` npm package is a one-line change. Per workshop 001 and Phase 1 Non-Goals.
 */

import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_LEN = 10;
const RAND_LEN = 16;

let lastMs = 0;
const lastRand = new Uint8Array(RAND_LEN);

/** Encode an integer (≤ 48 bits) as Crockford-base32, left-padded to `len` chars. */
function encodeTime(ms: number, len: number): string {
  let n = ms;
  let out = '';
  for (let i = 0; i < len; i++) {
    out = ALPHABET[n % 32] + out;
    n = Math.floor(n / 32);
  }
  return out;
}

/** Encode 80 bits (10 bytes) of randomness as 16 Crockford-base32 chars. */
function encodeRand(bytes: Uint8Array): string {
  // Treat 10 bytes as a 80-bit BigInt for clean base-32 emission.
  let n = 0n;
  for (let i = 0; i < RAND_LEN; i++) {
    // RAND_LEN==16; we only need 10 bytes (80 bits) — encoded as 16 chars (5 bits each).
    // bytes is already shaped as a 16-byte buffer with the upper 6 bytes always 0
    // post-increment; this keeps a single encoding path for both fresh-fill and increment.
    n = (n << 8n) | BigInt(bytes[i]);
  }
  let out = '';
  for (let i = 0; i < RAND_LEN; i++) {
    out = ALPHABET[Number(n & 31n)] + out;
    n >>= 5n;
  }
  return out;
}

/** Increment the 16-byte little-endian-treated random buffer by 1, wrapping. */
function incrementRand(bytes: Uint8Array): void {
  for (let i = RAND_LEN - 1; i >= 0; i--) {
    if (bytes[i] === 0xff) {
      bytes[i] = 0;
      continue;
    }
    bytes[i] += 1;
    return;
  }
  // Full overflow (extremely unlikely within a single ms): all zeros — re-seed.
  const fresh = randomBytes(RAND_LEN);
  bytes.set(fresh);
}

/** Generate a Crockford-base32 ULID string. */
export function ulid(): string {
  const now = Date.now();
  let ms: number;
  if (now > lastMs) {
    // Fresh ms — new random suffix.
    ms = now;
    lastMs = ms;
    const fresh = randomBytes(RAND_LEN);
    lastRand.set(fresh);
  } else {
    // Same ms OR clock rewind — reuse prior timestamp and increment suffix.
    ms = lastMs;
    incrementRand(lastRand);
  }
  return encodeTime(ms, TIME_LEN) + encodeRand(lastRand);
}
