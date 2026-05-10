/**
 * Schema backward compatibility tests.
 * Verifies that outputs without new optional fields still validate.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  validateOutput,
  validateSystemOutput,
} from '../../src/runner/validator.js';

describe('Schema backward compatibility', () => {
  let tmpDir: string;
  const systemOutputSchema = path.resolve('src/schemas/system-output.json');
  const retrospectiveSchema = path.resolve('src/schemas/retrospective.json');

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(
      path.join(import.meta.dirname ?? __dirname, 'tmp-schema-'),
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('validates output without magicWandTarget or difficulties', () => {
    const outputPath = path.join(tmpDir, 'report.json');
    fs.writeFileSync(
      outputPath,
      JSON.stringify({
        summary: 'Completed the task successfully.',
        retrospective: {
          workedWell: 'Everything worked smoothly.',
          confusing: 'Nothing was confusing at all.',
          magicWand: 'Add a --verbose flag for debugging output.',
        },
      }),
    );
    const result = validateSystemOutput(outputPath);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validates output WITH magicWandTarget and difficulties', () => {
    const outputPath = path.join(tmpDir, 'report.json');
    fs.writeFileSync(
      outputPath,
      JSON.stringify({
        summary: 'Completed the task with some friction.',
        retrospective: {
          workedWell: 'The CLI tools were discoverable.',
          confusing: 'MCP config was hard to set up.',
          magicWand: 'Add auto-detection for MCP config location.',
          magicWandTarget: 'minih',
          difficulties: [
            {
              category: 'config',
              description:
                'MCP server cwd defaults to run folder, not project root',
              workaround: 'Manually set cwd in .mcp.json',
              severity: 'degrading',
            },
          ],
        },
      }),
    );
    const result = validateSystemOutput(outputPath);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('allows unknown magicWandTarget values (system validator is permissive)', () => {
    const outputPath = path.join(tmpDir, 'report.json');
    fs.writeFileSync(
      outputPath,
      JSON.stringify({
        summary: 'Completed the task successfully.',
        retrospective: {
          workedWell: 'Everything worked smoothly.',
          confusing: 'Nothing was confusing at all.',
          magicWand: 'Add a --verbose flag for debugging output.',
          magicWandTarget: 'some-other-value',
        },
      }),
    );
    // System validator only checks required fields — doesn't enforce magicWandTarget enum
    const result = validateSystemOutput(outputPath);
    expect(result.valid).toBe(true);
  });

  it('allows extra fields in retrospective (additionalProperties: true)', () => {
    const outputPath = path.join(tmpDir, 'report.json');
    fs.writeFileSync(
      outputPath,
      JSON.stringify({
        summary: 'Completed the task successfully.',
        retrospective: {
          workedWell: 'Everything worked smoothly.',
          confusing: 'Nothing was confusing at all.',
          magicWand: 'Add a --verbose flag for debugging output.',
          difficulties: [{ category: 'build' }],
          someRandomField: 'should be allowed',
        },
      }),
    );
    // System validator only checks required fields — additionalProperties are allowed
    const result = validateSystemOutput(outputPath);
    expect(result.valid).toBe(true);
  });

  it('validates coordination feedback in the bundled system-output schema', () => {
    const outputPath = path.join(tmpDir, 'report.json');
    fs.writeFileSync(
      outputPath,
      JSON.stringify({
        summary: 'Completed a coordinated run with peer-visible state updates.',
        retrospective: {
          workedWell: 'The inside and outside coordination loop was clear.',
          confusing: 'Nothing was confusing in the coordination loop.',
          magicWand: 'Make coordination run snapshots easier to discover.',
          magicWandTarget: 'coordination',
          coordination: {
            peerUpdatesSent: 2,
            unresolvedPeerRequests: 0,
            statePublished: true,
            notes: 'Peer was notified before final output.',
          },
        },
      }),
    );

    const result = validateOutput(systemOutputSchema, outputPath);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validates coordination feedback in the bundled retrospective schema', () => {
    const outputPath = path.join(tmpDir, 'retrospective.json');
    fs.writeFileSync(
      outputPath,
      JSON.stringify({
        workedWell: 'The coordination tools were easy to find.',
        confusing: 'Nothing was confusing in this test run.',
        magicWand:
          'Add a concise coordination health summary to completed metadata.',
        magicWandTarget: 'coordination',
        coordination: {
          peerUpdatesSent: 1,
          unresolvedPeerRequests: 0,
          statePublished: false,
        },
      }),
    );

    const result = validateOutput(retrospectiveSchema, outputPath);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
