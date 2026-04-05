/**
 * Agent output validator — JSON Schema validation via AJV.
 *
 * Validates agent output against output-schema.json and input params
 * against input-schema.json. Uses AJV 2020-12 with allErrors.
 *
 * Fresh AJV instance per call — simple, no caching bugs (DYK #2).
 *
 * Extracted from: harness/src/agent/validator.ts
 */

import * as fs from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import type { ValidationResult } from './types.js';

/**
 * Validate input parameters against an input schema.
 * Used by the runner before prompt assembly to fail fast.
 */
export function validateInput(
  schemaPath: string,
  params: Record<string, string>,
): ValidationResult {
  if (!fs.existsSync(schemaPath)) {
    return {
      valid: false,
      errors: [`Input schema file not found: ${schemaPath}`],
    };
  }

  let schemaData: unknown;
  try {
    schemaData = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      valid: false,
      errors: [`Input schema is not valid JSON: ${message}`],
    };
  }

  const ajv = new Ajv2020({ allErrors: true });

  let validate: ReturnType<typeof ajv.compile>;
  try {
    validate = ajv.compile(schemaData as Record<string, unknown>);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      valid: false,
      errors: [`Input schema compilation failed: ${message}`],
    };
  }

  const valid = validate(params);
  if (valid) {
    return { valid: true, errors: [] };
  }

  const errors = (validate.errors ?? []).map((e) => {
    const path = e.instancePath || '/';
    return `${path}: ${e.message ?? 'unknown error'}`;
  });

  return { valid: false, errors };
}

/**
 * Validate an output file against a JSON Schema.
 *
 * Pre-validates for: missing file, empty file, invalid JSON.
 * Validation failure = { valid: false, errors } — never throws.
 */
export function validateOutput(
  schemaPath: string,
  outputPath: string,
): ValidationResult {
  if (!fs.existsSync(schemaPath)) {
    return { valid: false, errors: [`Schema file not found: ${schemaPath}`] };
  }

  if (!fs.existsSync(outputPath)) {
    return { valid: false, errors: [`Output file not found: ${outputPath}`] };
  }

  const outputContent = fs.readFileSync(outputPath, 'utf-8').trim();
  if (!outputContent) {
    return { valid: false, errors: ['Output file is empty'] };
  }

  let outputData: unknown;
  try {
    outputData = JSON.parse(outputContent);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, errors: [`Output is not valid JSON: ${message}`] };
  }

  let schemaData: unknown;
  try {
    schemaData = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, errors: [`Schema is not valid JSON: ${message}`] };
  }

  const ajv = new Ajv2020({ allErrors: true });

  let validate: ReturnType<typeof ajv.compile>;
  try {
    validate = ajv.compile(schemaData as Record<string, unknown>);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, errors: [`Schema compilation failed: ${message}`] };
  }

  const valid = validate(outputData);
  if (valid) {
    return { valid: true, errors: [] };
  }

  const errors = (validate.errors ?? []).map((e) => {
    const path = e.instancePath || '/';
    return `${path}: ${e.message ?? 'unknown error'}`;
  });

  return { valid: false, errors };
}

/**
 * Validate output against the minih system output contract.
 *
 * Every agent must produce JSON with at least `summary` and
 * `retrospective` (workedWell, confusing, magicWand).
 */
export function validateSystemOutput(outputPath: string): ValidationResult {
  if (!fs.existsSync(outputPath)) {
    return { valid: false, errors: ['Output file not found'] };
  }

  const outputContent = fs.readFileSync(outputPath, 'utf-8').trim();
  if (!outputContent) {
    return { valid: false, errors: ['Output file is empty'] };
  }

  let outputData: unknown;
  try {
    outputData = JSON.parse(outputContent);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, errors: [`Output is not valid JSON: ${message}`] };
  }

  const ajv = new Ajv2020({ allErrors: true });

  const systemSchema = {
    type: 'object',
    required: ['summary', 'retrospective'],
    additionalProperties: true,
    properties: {
      summary: { type: 'string', minLength: 20 },
      retrospective: {
        type: 'object',
        required: ['workedWell', 'confusing', 'magicWand'],
        additionalProperties: true,
        properties: {
          workedWell: { type: 'string', minLength: 10 },
          confusing: { type: 'string', minLength: 10 },
          magicWand: { type: 'string', minLength: 20 },
        },
      },
    },
  };

  let validate: ReturnType<typeof ajv.compile>;
  try {
    validate = ajv.compile(systemSchema);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      valid: false,
      errors: [`System schema compilation failed: ${message}`],
    };
  }

  const valid = validate(outputData);
  if (valid) {
    return { valid: true, errors: [] };
  }

  const errors = (validate.errors ?? []).map((e) => {
    const ePath = e.instancePath || '/';
    return `[system] ${ePath}: ${e.message ?? 'unknown error'}`;
  });

  return { valid: false, errors };
}
