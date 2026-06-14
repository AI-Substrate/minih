/**
 * Characterisation (027 Phase 1 / GH #25) — the LIVE release-default
 * fall-through to the FX008 boot gate.
 *
 * Thesis (validate-v2 Source-Truth, GF-5): the #25 repro is the *current
 * shipped default*, not a hypothetical. A new `coordination: enabled` agent
 * with NO explicit `permissions:` (and no sidecar `lockedDefault`) resolves —
 * via the release-default layer — to the `restricted` preset, which DENIES
 * write, so `assertCoordWriteAllowed` throws E205 before any SDK session opens.
 *
 * The gap this file closes (no existing test crossed this seam end-to-end):
 *   - `compile.test.ts` drives `compile()` but never feeds the result to the
 *     gate — it only asserts `presetName` / `decisions`.
 *   - `coord-write-precondition.test.ts` drives the gate but SYNTHESISES the
 *     policy ("No filesystem or compile() coupling"); case (a) stamps the
 *     `release-default` provenance LABEL by hand rather than resolving it.
 *   - `run-coord-write-deny.test.ts` (CLI) drives via *frontmatter*
 *     (`presetSource: 'frontmatter'`), not the release-default fall-through.
 *
 * So this file is the missing link: a REAL `compile()` release-default
 * resolution fed THROUGH the boot gate, mirroring the exact sources
 * `runner.ts` passes in production (`releaseDefault: { preset:
 * minihReleaseDefault }`, every other layer absent).
 *
 * Domain: runner.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compile } from '../../../src/runner/permissions/compile.js';
import {
  assertCoordWriteAllowed,
  CoordinationWriteDeniedError,
} from '../../../src/runner/permissions/coord-write-precondition.js';
import {
  getPreset,
  minihReleaseDefault,
} from '../../../src/runner/permissions/presets.js';

let tmp: string;

beforeEach(() => {
  // A real cwd with a `.git` marker so `compile()`'s git-root resolution
  // (fs-guard) succeeds — same fixture shape as compile.test.ts.
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-coord-relrelease-'));
  fs.mkdirSync(path.join(tmp, '.git'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const coordEnabled = {
  slug: 'coord-agent',
  coordination: { enabled: true },
} as const;

describe('boot gate — live release-default fall-through (#25 / GF-5)', () => {
  it('a coord agent with no explicit permissions resolves restricted/write-deny via release-default', () => {
    // Mirrors runner.ts for an agent with NO frontmatter/sidecar/env: only
    // the releaseDefault layer is populated, exactly as production passes it.
    const resolved = compile({
      releaseDefault: { preset: minihReleaseDefault },
      cwd: tmp,
    });

    expect(resolved.presetName).toBe('restricted');
    expect(resolved.presetSource).toBe('release-default');
    expect(resolved.decisions.write).toBe('deny');
  });

  it('that real resolved policy throws E205 at the boot gate — no silent missing report.json', () => {
    const resolved = compile({
      releaseDefault: { preset: minihReleaseDefault },
      cwd: tmp,
    });

    expect(() => assertCoordWriteAllowed(coordEnabled, resolved)).toThrow(
      CoordinationWriteDeniedError,
    );

    try {
      assertCoordWriteAllowed(coordEnabled, resolved);
      throw new Error('expected E205 to throw');
    } catch (err) {
      const e = err as CoordinationWriteDeniedError;
      expect(e.errorCode).toBe('E205');
      expect(e.kind).toBe('coord-write-deny');
      // The provenance label is the one compile() actually stamped — not a
      // hand-synthesised 'release-default' string (the case-(a) gap).
      expect(e.presetSource).toBe('release-default');
      expect(e.presetName).toBe('restricted');
      expect(e.message).toContain('E205 COORDINATION_WRITE_DENIED');
      expect(e.message).toContain('Resolved from: release-default');
    }
  });

  it('the bare release-default fallback (no releaseDefault.preset) reaches the same write-deny gate', () => {
    // Defense in depth: even when the releaseDefault layer carries no preset,
    // compile() falls through to the `minihReleaseDefault` constant.
    const resolved = compile({ releaseDefault: {}, cwd: tmp });

    expect(resolved.presetName).toBe(minihReleaseDefault);
    expect(resolved.presetSource).toBe('release-default');
    expect(resolved.decisions.write).toBe('deny');
    expect(() => assertCoordWriteAllowed(coordEnabled, resolved)).toThrow(
      CoordinationWriteDeniedError,
    );
  });

  it('a grandfathered sidecar lockedDefault: yolo keeps write-allow → gate does NOT fire', () => {
    // GF-5 asymmetry: installs carrying a sticky `yolo` sidecar lockedDefault
    // resolve via the *sidecar* layer to write-allow, so the boot gate passes.
    // This is why the fix is backward-safe for grandfathered agents.
    const resolved = compile({
      sidecar: { preset: 'yolo' },
      releaseDefault: { preset: minihReleaseDefault },
      cwd: tmp,
    });

    expect(resolved.presetName).toBe('yolo');
    expect(resolved.presetSource).toBe('sidecar');
    expect(resolved.decisions.write).toBe('allow');
    expect(() => assertCoordWriteAllowed(coordEnabled, resolved)).not.toThrow();
  });

  it('premise guard — if a future release re-flips the shipped default, this test goes red', () => {
    // The #25 repro is "live" ONLY while the shipped default denies write.
    // Pin that premise so a re-flip forces a conscious re-evaluation of the
    // repro (dossier T001 note) instead of the characterisation silently
    // rotting into a false-green.
    expect(minihReleaseDefault).toBe('restricted');
    expect(getPreset(minihReleaseDefault).write).toBe('deny');
  });
});
