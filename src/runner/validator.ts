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

/** Levenshtein distance between two strings. */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

/** Find a near-match for a missing property among actual keys. */
function findNearMatch(missing: string, actualKeys: string[]): string | null {
  const lower = missing.toLowerCase();
  // Substring containment first (health → healthStatus)
  for (const key of actualKeys) {
    const kl = key.toLowerCase();
    if (kl.includes(lower) || lower.includes(kl)) return key;
  }
  // Levenshtein for typos (healht → health)
  let best: string | null = null;
  let bestDist = 4;
  for (const key of actualKeys) {
    const dist = levenshtein(lower, key.toLowerCase());
    if (dist < bestDist) {
      bestDist = dist;
      best = key;
    }
  }
  return best;
}

/** Format AJV errors with fuzzy suggestions for missing properties. */
function formatErrors(
  errors: Array<{
    instancePath?: string;
    message?: string;
    keyword?: string;
    params?: Record<string, unknown>;
  }>,
  data: unknown,
  prefix?: string,
): string[] {
  return errors.map((e) => {
    const path = e.instancePath || '/';
    let msg = `${prefix ? `${prefix} ` : ''}${path}: ${e.message ?? 'unknown error'}`;

    if (e.keyword === 'required' && e.params?.missingProperty) {
      const parentPath = e.instancePath || '';
      let parent = data as Record<string, unknown>;
      if (parentPath) {
        for (const seg of parentPath.split('/').filter(Boolean)) {
          parent = (parent as Record<string, unknown>)?.[seg] as Record<
            string,
            unknown
          >;
        }
      }
      if (parent && typeof parent === 'object') {
        const suggestion = findNearMatch(
          String(e.params.missingProperty),
          Object.keys(parent),
        );
        if (suggestion) {
          msg += ` — did you mean '${suggestion}'?`;
        }
      }
    }

    return msg;
  });
}

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

  const errors = formatErrors(validate.errors ?? [], params);

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

  const errors = formatErrors(validate.errors ?? [], outputData);

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

  const errors = formatErrors(validate.errors ?? [], outputData, '[system]');

  return { valid: false, errors };
}
