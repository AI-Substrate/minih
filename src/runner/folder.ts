/**
 * Agent folder management — discovery, slug validation, run folder creation.
 *
 * Agent definitions live at <agentsDir>/<slug>/ with at least prompt.md.
 * Run folders are created under <agentsDir>/<slug>/runs/<timestamp-suffix>/.
 *
 * Extracted from: harness/src/agent/folder.ts
 * Adapted: configurable agents dir, frontmatter parsing (new).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { AgentDefinition } from './types.js';

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
  body: string;
} {
  if (!content.startsWith('---\n')) {
    return { description: '', tags: [], body: content };
  }

  // Search for closing \n---\n starting after the opening ---\n
  // For empty frontmatter (---\n---\n), the closing starts at pos 3
  const endIndex = content.indexOf('\n---\n', 3);
  if (endIndex === -1) {
    // Check for --- at end of file (no trailing newline after closing ---)
    if (content.endsWith('\n---')) {
      const yamlBlock = content.slice(4, content.length - 4);
      const parsed = parseYamlSimple(yamlBlock);
      return { ...parsed, body: '' };
    }
    return { description: '', tags: [], body: content };
  }

  const yamlBlock = content.slice(4, endIndex);
  const body = content.slice(endIndex + 5); // skip \n---\n
  const parsed = parseYamlSimple(yamlBlock);
  return { ...parsed, body };
}

/** Minimal YAML parser for frontmatter — handles description and tags only. */
function parseYamlSimple(yaml: string): { description: string; tags: string[] } {
  let description = '';
  let tags: string[] = [];

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
  }

  return { description, tags };
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
    const { description, tags } = parseFrontmatter(promptContent);

    // Require frontmatter with description (per spec clarification)
    if (!description.trim()) continue;

    agents.push({
      slug: entry.name,
      description,
      tags,
      dir,
      promptPath,
      schemaPath: fs.existsSync(schemaPath) ? schemaPath : null,
      instructionsPath: fs.existsSync(instructionsPath) ? instructionsPath : null,
      inputSchemaPath: fs.existsSync(inputSchemaPath) ? inputSchemaPath : null,
    });
  }

  return agents.sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * Resolve an agent definition by slug.
 * @returns AgentDefinition or null if not found
 */
export function resolveAgent(slug: string, agentsDir: string): AgentDefinition | null {
  const agents = listAgents(agentsDir);
  return agents.find((a) => a.slug === slug) ?? null;
}

/**
 * Create a timestamped run folder under <agent>/runs/.
 * Freezes copies of prompt, instructions, and schemas.
 * @returns Absolute path to the created run folder + the run ID
 */
export function createRunFolder(agentDef: AgentDefinition): { runDir: string; runId: string } {
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
    fs.copyFileSync(agentDef.instructionsPath, path.join(runDir, 'instructions.md'));
  }
  if (agentDef.schemaPath) {
    fs.copyFileSync(agentDef.schemaPath, path.join(runDir, 'output-schema.json'));
  }
  if (agentDef.inputSchemaPath) {
    fs.copyFileSync(agentDef.inputSchemaPath, path.join(runDir, 'input-schema.json'));
  }

  fs.mkdirSync(path.join(runDir, 'output'), { recursive: true });

  return { runDir, runId };
}
