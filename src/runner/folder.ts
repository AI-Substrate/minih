/**
 * Agent folder management — discovery, slug validation, run folder creation.
 *
 * Agent definitions live at <agentsDir>/<slug>/ with at least prompt.md.
 * Run folders are created under <agentsDir>/<slug>/runs/<timestamp-suffix>/.
 *
 * Extracted from: harness/src/agent/folder.ts
 * Adapted: configurable agents dir, frontmatter parsing (new).
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  AgentDefinition,
  CoordinationFrontmatter,
  Side,
} from './types.js';

/** Hard ceiling on `outside.md` body — prompt-blowup guard. */
const OUTSIDE_MD_MAX_BYTES = 16 * 1024;

const SLUG_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Validate an agent slug for path safety.
 * @returns null if valid, error message if invalid
 */
export function validateSlug(slug: string): string | null {
  if (!slug) return 'Agent slug cannot be empty';
  if (slug.includes('..')) return 'Agent slug cannot contain ".."';
  if (slug.includes('/')) return 'Agent slug cannot contain "/"';
  if (slug.includes('\\')) return 'Agent slug cannot contain "\\"';
  if (slug.includes('\0')) return 'Agent slug cannot contain null bytes';
  if (!SLUG_PATTERN.test(slug)) {
    return `Agent slug must match [a-zA-Z0-9_-]{1,64}, got: "${slug}"`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Coordination path helpers (P1 / Phase 007)
//
// Every helper:
// 1. Validates `slug` via `validateSlug` (path-traversal guard).
// 2. Returns an absolute path (resolves `agentsDir` first) so P3 forwarders,
//    P4 spawn config, and P5 CLI can use the result without re-resolving.
//
// Path constants live here; downstream owners hold the file format + write
// logic. For example, P3 owns `sdk-watermark.json`'s schema and writes; P1
// just exports `watermarkPath()`.
// ---------------------------------------------------------------------------

export class InvalidCoordinationFrontmatterError extends Error {
  constructor(message: string) {
    super(`invalid coordination frontmatter: ${message}`);
    this.name = 'InvalidCoordinationFrontmatterError';
  }
}

export class InvalidSlugError extends Error {
  constructor(slug: string, reason: string) {
    super(`invalid agent slug "${slug}": ${reason}`);
    this.name = 'InvalidSlugError';
  }
}

export class OutsideAgentsDirError extends Error {
  constructor(target: string, agentsDir: string) {
    super(
      `${target} resolves outside agentsDir ${agentsDir} — refusing to follow symlink (path traversal guard)`,
    );
    this.name = 'OutsideAgentsDirError';
  }
}

export interface CoordinationRunLocation {
  slug: string;
  agentsDir: string;
  runId: string;
}

function ensureValidSlug(slug: string): void {
  const err = validateSlug(slug);
  if (err !== null) throw new InvalidSlugError(slug, err);
}

function ensureValidRunId(runId: string): void {
  if (!runId) throw new InvalidSlugError(runId, 'Run ID cannot be empty');
  if (runId.includes('..')) {
    throw new InvalidSlugError(runId, 'Run ID cannot contain ".."');
  }
  if (runId.includes('/')) {
    throw new InvalidSlugError(runId, 'Run ID cannot contain "/"');
  }
  if (runId.includes('\\')) {
    throw new InvalidSlugError(runId, 'Run ID cannot contain "\\"');
  }
  if (runId.includes('\0')) {
    throw new InvalidSlugError(runId, 'Run ID cannot contain null bytes');
  }
  if (!/^[a-zA-Z0-9_.:-]{1,160}$/.test(runId)) {
    throw new InvalidSlugError(
      runId,
      `Run ID must match [a-zA-Z0-9_.:-]{1,160}, got: "${runId}"`,
    );
  }
}

function resolveAbs(agentsDir: string): string {
  return path.resolve(agentsDir);
}

export function coordinationRunLocation(
  slug: string,
  agentsDir: string,
  runId: string,
): CoordinationRunLocation {
  ensureValidSlug(slug);
  ensureValidRunId(runId);
  return { slug, agentsDir: resolveAbs(agentsDir), runId };
}

export function coordinationRunDir(location: CoordinationRunLocation): string {
  ensureValidSlug(location.slug);
  ensureValidRunId(location.runId);
  return path.join(
    resolveAbs(location.agentsDir),
    location.slug,
    'runs',
    location.runId,
  );
}

/** Absolute path to `agents/<slug>/inbox/<lane>/messages.ndjson`. */
export function inboxLanePath(
  location: CoordinationRunLocation,
  lane: Side,
): string {
  return path.join(
    coordinationRunDir(location),
    'inbox',
    lane,
    'messages.ndjson',
  );
}

/** Absolute path to `agents/<slug>/state/<side>.json`. */
export function stateFilePath(
  location: CoordinationRunLocation,
  side: Side,
): string {
  return path.join(coordinationRunDir(location), 'state', `${side}.json`);
}

/** Absolute path to `agents/<slug>/state/history.ndjson`. */
export function historyPath(location: CoordinationRunLocation): string {
  return path.join(coordinationRunDir(location), 'state', 'history.ndjson');
}

/**
 * Absolute path to the SDK forwarder's per-run watermark file.
 * P3 owns the file format + write logic; P1 only owns the path constant
 * (so it lives alongside the other coordination paths).
 */
export function watermarkPath(location: CoordinationRunLocation): string {
  return path.join(coordinationRunDir(location), 'state', 'sdk-watermark.json');
}

/** Absolute path to `agents/<slug>/outside.md`. */
export function outsideMdPath(slug: string, agentsDir: string): string {
  ensureValidSlug(slug);
  return path.join(resolveAbs(agentsDir), slug, 'outside.md');
}

/**
 * Whether `outside.md` exists for `slug`. Symlinks are followed; a symlink
 * resolving outside `agentsDir` throws `OutsideAgentsDirError`.
 */
export function hasOutsideMd(slug: string, agentsDir: string): boolean {
  ensureValidSlug(slug);
  const target = outsideMdPath(slug, agentsDir);
  if (!fs.existsSync(target)) return false;
  // Follow symlinks via realpathSync; ensure the resolved path is still inside
  // agentsDir to prevent symlink-based path traversal.
  const realDir = fs.realpathSync(resolveAbs(agentsDir));
  const realTarget = fs.realpathSync(target);
  if (!realTarget.startsWith(realDir + path.sep) && realTarget !== realDir) {
    throw new OutsideAgentsDirError(realTarget, realDir);
  }
  return fs.statSync(target).isFile();
}

/**
 * Read `outside.md` body if present. Returns:
 * - `undefined` when the file is absent
 * - `''` for present-but-empty (lets consumers distinguish absent vs empty)
 * - body string truncated to 16KB with a `console.warn` if larger
 */
function readOutsideContract(
  slug: string,
  agentsDir: string,
): string | undefined {
  if (!hasOutsideMd(slug, agentsDir)) return undefined;
  const target = outsideMdPath(slug, agentsDir);
  const stats = fs.statSync(target);
  if (stats.size > OUTSIDE_MD_MAX_BYTES) {
    console.warn(
      `outside.md for ${slug} is ${stats.size} bytes; truncating to ${OUTSIDE_MD_MAX_BYTES} (P6 doctor will surface 4KB warn / 8KB error)`,
    );
    const fd = fs.openSync(target, 'r');
    try {
      const buf = Buffer.alloc(OUTSIDE_MD_MAX_BYTES);
      const bytesRead = fs.readSync(fd, buf, 0, OUTSIDE_MD_MAX_BYTES, 0);
      return buf.slice(0, bytesRead).toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  }
  return fs.readFileSync(target, 'utf8');
}

/**
 * Parse YAML frontmatter from markdown content.
 *
 * Frontmatter must start at position 0 with `---\n`, followed by YAML,
 * followed by `\n---\n`. Markdown horizontal rules (`---`) in the body
 * are NOT treated as frontmatter delimiters.
 *
 * Hand-rolled (~15 lines) per DYK #4 — no gray-matter dependency.
 */
export function parseFrontmatter(content: string): {
  description: string;
  tags: string[];
  model?: string;
  reasoning?: string;
  timeout?: number;
  /** Always populated (workshop 005:95) — `{enabled:false}` when absent or `disabled`. */
  coordination: CoordinationFrontmatter;
  body: string;
} {
  content = content.replace(/\r\n/g, '\n');
  if (!content.startsWith('---\n')) {
    return {
      description: '',
      tags: [],
      coordination: { enabled: false },
      body: content,
    };
  }

  // Search for closing \n---\n starting after the opening ---\n
  // For empty frontmatter (---\n---\n), the closing starts at pos 3
  const endIndex = content.indexOf('\n---\n', 3);
  if (endIndex === -1) {
    // Check for --- at end of file (no trailing newline after closing ---)
    if (content.endsWith('\n---')) {
      const yamlBlock = content.slice(4, content.length - 4);
      const parsed = parseYamlSimple(yamlBlock);
      const coordination = parseCoordinationField(yamlBlock);
      return { ...parsed, coordination, body: '' };
    }
    return {
      description: '',
      tags: [],
      coordination: { enabled: false },
      body: content,
    };
  }

  const yamlBlock = content.slice(4, endIndex);
  const body = content.slice(endIndex + 5); // skip \n---\n
  const parsed = parseYamlSimple(yamlBlock);
  const coordination = parseCoordinationField(yamlBlock);
  return { ...parsed, coordination, body };
}

/** Minimal YAML parser for frontmatter. */
function parseYamlSimple(yaml: string): {
  description: string;
  tags: string[];
  model?: string;
  reasoning?: string;
  timeout?: number;
} {
  let description = '';
  let tags: string[] = [];
  let model: string | undefined;
  let reasoning: string | undefined;
  let timeout: number | undefined;

  for (const line of yaml.split('\n')) {
    const descMatch = line.match(/^description:\s*"([^"]*)"$/);
    if (descMatch) {
      description = descMatch[1];
      continue;
    }
    const descMatchSingle = line.match(/^description:\s*'([^']*)'$/);
    if (descMatchSingle) {
      description = descMatchSingle[1];
      continue;
    }
    const descMatchUnquoted = line.match(/^description:\s*(.+)$/);
    if (descMatchUnquoted && !descMatch && !descMatchSingle) {
      description = descMatchUnquoted[1].trim();
      continue;
    }
    const tagsMatch = line.match(/^tags:\s*\[([^\]]*)\]$/);
    if (tagsMatch) {
      tags = tagsMatch[1]
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
    }
    const modelMatch = line.match(/^model:\s*(.+)$/);
    if (modelMatch) {
      model = modelMatch[1].trim().replace(/^["']|["']$/g, '');
    }
    const reasoningMatch = line.match(/^reasoning:\s*(.+)$/);
    if (reasoningMatch) {
      reasoning = reasoningMatch[1].trim().replace(/^["']|["']$/g, '');
    }
    const timeoutMatch = line.match(/^timeout:\s*(\d+)$/);
    if (timeoutMatch) {
      timeout = Number.parseInt(timeoutMatch[1], 10);
    }
  }

  return { description, tags, model, reasoning, timeout };
}

/**
 * Parse the optional `coordination` frontmatter field. Always returns a
 * normalized `{enabled: boolean, outside?, inside?}` shape (workshop 005:95).
 *
 * Accepted forms:
 *   `coordination: enabled`         → `{enabled: true}`
 *   `coordination: disabled`        → `{enabled: false}`
 *   `coordination:`
 *     `  enabled: true`
 *     `  outside: ...`              → `{enabled: true, outside: {...}}`
 *
 * Absent → `{enabled: false}`. Unknown string values, missing-`enabled`
 * object form, etc., throw `InvalidCoordinationFrontmatterError`.
 */
function parseCoordinationField(yaml: string): CoordinationFrontmatter {
  const lines = yaml.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^coordination:\s*(.*)$/);
    if (!m) continue;

    const value = m[1].trim();

    // String form: `coordination: enabled` / `coordination: disabled`
    if (value === 'enabled') return { enabled: true };
    if (value === 'disabled') return { enabled: false };

    // Empty value → object form follows on indented lines
    if (value === '') {
      const result: CoordinationFrontmatter = { enabled: false };
      let sawEnabled = false;
      for (let j = i + 1; j < lines.length; j++) {
        const sub = lines[j];
        // Stop at first non-indented line (next top-level key)
        if (!sub.match(/^\s/) && sub.trim() !== '') break;
        const enabledM = sub.match(/^\s+enabled:\s*(true|false)\s*$/);
        if (enabledM) {
          result.enabled = enabledM[1] === 'true';
          sawEnabled = true;
          continue;
        }
        // `outside` / `inside` accept inline JSON object literals (e.g.,
        // `outside: {"audience":"ci"}`). Parse strictly via JSON.parse —
        // empty `{}` is also a valid (empty) shape. Anything that isn't
        // valid JSON throws so authors get a clear error instead of
        // silently losing the payload (per code-review F001 2026-04-26).
        const subKeyM = sub.match(/^\s+(outside|inside):\s*(.+)$/);
        if (subKeyM) {
          const key = subKeyM[1] as 'outside' | 'inside';
          const rawValue = subKeyM[2].trim();
          try {
            const parsed = JSON.parse(rawValue);
            if (
              parsed === null ||
              typeof parsed !== 'object' ||
              Array.isArray(parsed)
            ) {
              throw new InvalidCoordinationFrontmatterError(
                `${key}: must be a JSON object literal, got ${rawValue}`,
              );
            }
            result[key] = parsed as Record<string, unknown>;
          } catch (err) {
            if (err instanceof InvalidCoordinationFrontmatterError) throw err;
            throw new InvalidCoordinationFrontmatterError(
              `${key}: invalid JSON value "${rawValue}" (${(err as Error).message})`,
            );
          }
        }
      }
      if (!sawEnabled) {
        throw new InvalidCoordinationFrontmatterError(
          'object form requires `enabled: true|false` field',
        );
      }
      return result;
    }

    // Anything else is invalid.
    throw new InvalidCoordinationFrontmatterError(
      `unknown value "${value}"; expected one of: enabled, disabled, or an object form with \`enabled: true|false\``,
    );
  }
  return { enabled: false };
}

/**
 * List all available agent definitions by scanning for prompt.md files.
 * Skips underscore-prefixed folders (_shared, _templates, etc.).
 */
export function listAgents(agentsDir: string): AgentDefinition[] {
  agentsDir = path.resolve(agentsDir);
  if (!fs.existsSync(agentsDir)) return [];

  const entries = fs.readdirSync(agentsDir, { withFileTypes: true });
  const agents: AgentDefinition[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('_')) continue;

    const slugError = validateSlug(entry.name);
    if (slugError) continue;

    const dir = path.join(agentsDir, entry.name);
    const promptPath = path.join(dir, 'prompt.md');

    if (!fs.existsSync(promptPath)) continue;

    const schemaPath = path.join(dir, 'output-schema.json');
    const instructionsPath = path.join(dir, 'instructions.md');
    const inputSchemaPath = path.join(dir, 'input-schema.json');

    // Parse frontmatter for description and tags
    const promptContent = fs.readFileSync(promptPath, 'utf-8');
    const { description, tags, model, reasoning, timeout, coordination } =
      parseFrontmatter(promptContent);

    // Require frontmatter with description (per spec clarification)
    if (!description.trim()) continue;

    agents.push({
      slug: entry.name,
      description,
      tags,
      model,
      reasoning,
      timeout,
      dir,
      promptPath,
      schemaPath: fs.existsSync(schemaPath) ? schemaPath : null,
      instructionsPath: fs.existsSync(instructionsPath)
        ? instructionsPath
        : null,
      inputSchemaPath: fs.existsSync(inputSchemaPath) ? inputSchemaPath : null,
      outsideContract: readOutsideContract(entry.name, agentsDir),
      coordination,
    });
  }

  return agents.sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * Resolve an agent definition by slug.
 * @returns AgentDefinition or null if not found
 */
export function resolveAgent(
  slug: string,
  agentsDir: string,
): AgentDefinition | null {
  const agents = listAgents(agentsDir);
  return agents.find((a) => a.slug === slug) ?? null;
}

/**
 * Create a timestamped run folder under <agent>/runs/.
 * Freezes copies of prompt, instructions, and schemas.
 * @returns Absolute path to the created run folder + the run ID
 */
export function createRunFolder(agentDef: AgentDefinition): {
  runDir: string;
  runId: string;
} {
  const now = new Date();
  const suffix = crypto.randomBytes(2).toString('hex');
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  const runId = `${yyyy}-${mm}-${dd}T${hh}-${min}-${ss}-${ms}Z-${suffix}`;

  const runsDir = path.join(agentDef.dir, 'runs');
  const runDir = path.join(runsDir, runId);
  fs.mkdirSync(runDir, { recursive: true });

  // Freeze copies of inputs into run folder
  fs.copyFileSync(agentDef.promptPath, path.join(runDir, 'prompt.md'));
  if (agentDef.instructionsPath) {
    fs.copyFileSync(
      agentDef.instructionsPath,
      path.join(runDir, 'instructions.md'),
    );
  }
  if (agentDef.schemaPath) {
    fs.copyFileSync(
      agentDef.schemaPath,
      path.join(runDir, 'output-schema.json'),
    );
  }
  if (agentDef.inputSchemaPath) {
    fs.copyFileSync(
      agentDef.inputSchemaPath,
      path.join(runDir, 'input-schema.json'),
    );
  }

  fs.mkdirSync(path.join(runDir, 'output'), { recursive: true });

  return { runDir, runId };
}

/** Session lookup result from a prior run. */
export interface RunSession {
  sessionId: string;
  runId: string;
  runDir: string;
}

/**
 * Find the session ID from a prior run for session resume.
 *
 * @param slug - Agent slug
 * @param agentsDir - Agents directory
 * @param runId - Specific run ID (optional — uses latest if omitted)
 * @returns RunSession or null if not found
 */
export function findRunSession(
  slug: string,
  agentsDir: string,
  runId?: string,
): RunSession | null {
  const agentDir = path.join(path.resolve(agentsDir), slug);
  const runsDir = path.join(agentDir, 'runs');

  if (!fs.existsSync(runsDir)) return null;

  let targetRunId: string;
  let targetRunDir: string;

  if (runId) {
    targetRunDir = path.join(runsDir, runId);
    if (!fs.existsSync(targetRunDir)) return null;
    targetRunId = runId;
  } else {
    // Find latest completed run (skip incomplete/corrupt entries)
    const entries = fs
      .readdirSync(runsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .sort((a, b) => b.name.localeCompare(a.name));

    for (const entry of entries) {
      const candidateDir = path.join(runsDir, entry.name);
      const completedPath = path.join(candidateDir, 'completed.json');
      if (!fs.existsSync(completedPath)) continue;
      try {
        const metadata = JSON.parse(fs.readFileSync(completedPath, 'utf-8'));
        if (metadata.sessionId) {
          return {
            sessionId: metadata.sessionId,
            runId: entry.name,
            runDir: candidateDir,
          };
        }
      } catch {}
    }
    return null;
  }

  const completedPath = path.join(targetRunDir, 'completed.json');
  if (!fs.existsSync(completedPath)) return null;

  try {
    const metadata = JSON.parse(fs.readFileSync(completedPath, 'utf-8'));
    if (!metadata.sessionId) return null;
    return {
      sessionId: metadata.sessionId,
      runId: targetRunId,
      runDir: targetRunDir,
    };
  } catch {
    return null;
  }
}

/**
 * Load MCP config from a JSON file.
 * Expected format: { "mcpServers": { ... } }
 * Fails fast with actionable error if file missing or invalid.
 */
export function loadMcpConfig(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`MCP config file not found: ${filePath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    throw new Error(`MCP config file is not valid JSON: ${filePath}`);
  }

  const obj = parsed as Record<string, unknown>;
  if (!obj.mcpServers || typeof obj.mcpServers !== 'object') {
    throw new Error(
      `MCP config file must have a "mcpServers" property: ${filePath}`,
    );
  }

  return obj.mcpServers as Record<string, unknown>;
}
