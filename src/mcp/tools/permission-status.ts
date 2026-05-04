/**
 * Plan 018 R6 stretch (T-S2) — `permission_status` MCP tool.
 *
 * Always-allowed tool exposed by the inside MCP server. Returns the resolved
 * policy as JSON so coordinated agents can self-introspect their permissions
 * without firing a permission request through the SDK.
 *
 * Pure read; no FS guard interaction (tools registered on the inside MCP
 * server are exempt from the FS guard — they're internal coordination
 * primitives, not user-facing file I/O).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  compilePermissionPolicy,
  parseFrontmatter,
  type ResolvedPolicy,
} from '../../runner/index.js';
import type { McpServerContext } from '../context.js';
import { McpToolError, type McpToolResult } from '../types.js';

export interface PermissionStatusResult {
  /** Slug of the agent this MCP server is serving. */
  agentSlug: string;
  /** Full resolved policy (preset + decisions + roots + provenance). */
  resolved: ResolvedPolicy;
  /** Snapshot of layered sources for debuggability. */
  resolutionChain: {
    frontmatter: unknown;
    sidecar: unknown;
    env: unknown;
    releaseDefault: unknown;
  };
}

export function permissionStatus(
  context: McpServerContext,
): McpToolResult<PermissionStatusResult> {
  const promptPath = path.join(context.agentDir, 'prompt.md');
  if (!fs.existsSync(promptPath)) {
    throw new McpToolError(
      'MCP_CONTEXT_INVALID',
      `prompt.md not found for agent "${context.agentSlug}" at ${promptPath}`,
    );
  }

  const promptContent = fs.readFileSync(promptPath, 'utf-8');
  const { permissions: frontmatterPolicy } = parseFrontmatter(promptContent);

  // Sidecar (best-effort)
  const sidecarPath = path.join(context.agentDir, '.minih-source.json');
  let sidecarLockedDefault: { preset: string } | undefined;
  if (fs.existsSync(sidecarPath)) {
    try {
      const sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf-8'));
      if (sidecar?.lockedDefault) {
        sidecarLockedDefault = { preset: sidecar.lockedDefault };
      }
    } catch {
      // bad sidecar — fall through; doctor surfaces the problem
    }
  }

  // Env
  const envPolicy = process.env.MINIH_PERMISSIONS_DEFAULT
    ? { preset: process.env.MINIH_PERMISSIONS_DEFAULT as never }
    : undefined;

  let resolved: ResolvedPolicy;
  try {
    resolved = compilePermissionPolicy({
      frontmatter: frontmatterPolicy,
      sidecar: sidecarLockedDefault as never,
      env: envPolicy as never,
      releaseDefault: { preset: 'restricted' as never },
      cwd: process.cwd(),
    });
  } catch (err) {
    throw new McpToolError(
      'MCP_INTERNAL_ERROR',
      `Could not resolve permissions: ${(err as Error).message}`,
    );
  }

  const result: PermissionStatusResult = {
    agentSlug: context.agentSlug,
    resolved,
    resolutionChain: {
      frontmatter: frontmatterPolicy ?? null,
      sidecar: sidecarLockedDefault ?? null,
      env: envPolicy ?? null,
      releaseDefault: { preset: 'restricted' },
    },
  };

  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    structuredContent: result,
  };
}
