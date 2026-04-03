import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateInput, validateOutput } from '../../src/runner/validator.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-val-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeJson(name: string, data: unknown): string {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
  return p;
}

describe('validateOutput', () => {
  it('valid output passes', () => {
    const schema = writeJson('schema.json', {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string' } },
    });
    const output = writeJson('report.json', { name: 'hello' });

    const result = validateOutput(schema, output);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('invalid output returns errors with paths', () => {
    const schema = writeJson('schema.json', {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      required: ['name', 'age'],
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
    });
    const output = writeJson('report.json', { name: 123 });

    const result = validateOutput(schema, output);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('handles missing output file', () => {
    const schema = writeJson('schema.json', { type: 'object' });
    const result = validateOutput(
      schema,
      path.join(tmpDir, 'nonexistent.json'),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/not found/i);
  });

  it('handles empty output file', () => {
    const schema = writeJson('schema.json', { type: 'object' });
    const outputPath = path.join(tmpDir, 'empty.json');
    fs.writeFileSync(outputPath, '');

    const result = validateOutput(schema, outputPath);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/empty/i);
  });

  it('handles invalid JSON in output', () => {
    const schema = writeJson('schema.json', { type: 'object' });
    const outputPath = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(outputPath, '{ not valid json }');

    const result = validateOutput(schema, outputPath);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/not valid JSON/i);
  });

  it('handles missing schema file', () => {
    const output = writeJson('report.json', { name: 'hello' });
    const result = validateOutput(path.join(tmpDir, 'no-schema.json'), output);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/not found/i);
  });

  it('handles schema compilation errors', () => {
    const schema = writeJson('schema.json', { type: 'not-a-type' });
    const output = writeJson('report.json', { name: 'hello' });

    const result = validateOutput(schema, output);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/compilation failed/i);
  });
});

describe('validateInput', () => {
  it('valid params pass', () => {
    const schema = writeJson('input.json', {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      required: ['file_path'],
      properties: { file_path: { type: 'string' } },
    });

    const result = validateInput(schema, { file_path: '/src/main.ts' });
    expect(result.valid).toBe(true);
  });

  it('missing required field fails', () => {
    const schema = writeJson('input.json', {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      required: ['file_path'],
      properties: { file_path: { type: 'string' } },
    });

    const result = validateInput(schema, {});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('handles missing schema file', () => {
    const result = validateInput(path.join(tmpDir, 'no-input.json'), {});
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/not found/i);
  });
});
