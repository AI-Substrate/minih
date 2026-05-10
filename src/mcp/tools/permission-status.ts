/**
 * Plan 018 R6 stretch (T-S2) — `permission_status` MCP tool.
 *
 * Always-allowed tool exposed by the inside MCP server. Returns the resolved
 * policy as JSON so coordinated agents can self-introspect their permissions
 * without firing a permission request through the SDK.
 *
 * Reads `run.json.permissions` (written by runner.ts at compile-time, F002)
 * which is the canonical source of truth. Falls back to recomputing from
 * frontmatter only if run.json is missing the field (e.g., stale runs).
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
  /** Where the resolved policy came from. */
  source: 'run.json' | 'recompiled-from-frontmatter';
  /** Snapshot of layered sources for debuggability (recompile path only). */
  resolutionChain?: {
    frontmatter: unknown;
    sidecar: unknown;
    env: unknown;
    releaseDefault: unknown;
  };
}

export function permissionStatus(
  context: McpServerContext,
): McpToolResult<PermissionStatusResult> {
  // Primary path — read run.json which the runner wrote at compile time.
  //
  // F003 (MEDIUM companion finding 2026-05-04): only trust the run.json
  // fast path when `presetSource` is present. Older run.json files don't
  // have it, and inventing a `release-default` label could send operators
  // to the wrong remediation layer (e.g. they edit the release default
  // when the real source was a stale frontmatter or sidecar). When
  // missing, fall through to the recompile path so provenance comes from
  // the current resolution chain.
  const runJsonPath = path.join(context.runDir, 'run.json');
  if (fs.existsSync(runJsonPath)) {
    try {
      const runJson = JSON.parse(fs.readFileSync(runJsonPath, 'utf-8'));
      if (runJson?.permissions?.preset && runJson.permissions.presetSource) {
        const fromManifest: ResolvedPolicy = {
          presetName: runJson.permissions.preset,
          presetSource: runJson.permissions.presetSource,
          decisions: runJson.permissions.decisions ?? {},
          canonicalRoots: runJson.permissions.canonicalRoots ?? [],
          rootsResolvedFrom: [], // not persisted in run.json
          ...(runJson.permissions.strictFs && { strictFs: true }),
          ...(runJson.permissions.mcpAllowedServers && {
            mcpAllowedServers: runJson.permissions.mcpAllowedServers,
          }),
          ...(runJson.permissions.customToolAllowedNames && {
            customToolAllowedNames: runJson.permissions.customToolAllowedNames,
          }),
        };
        const result: PermissionStatusResult = {
          agentSlug: context.agentSlug,
          resolved: fromManifest,
          source: 'run.json',
        };
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      }
    } catch {
      // fall through to recompile path
    }
  }

  // Fallback — recompile from frontmatter (loses CLI/env overrides).
  const promptPath = path.join(context.agentDir, 'prompt.md');
  if (!fs.existsSync(promptPath)) {
    throw new McpToolError(
      'MCP_CONTEXT_INVALID',
      `prompt.md not found for agent "${context.agentSlug}" at ${promptPath}`,
    );
  }

  const promptContent = fs.readFileSync(promptPath, 'utf-8');
  const { permissions: frontmatterPolicy } = parseFrontmatter(promptContent);

  const sidecarPath = path.join(context.agentDir, '.minih-source.json');
  let sidecarLockedDefault: { preset: string } | undefined;
  if (fs.existsSync(sidecarPath)) {
    try {
      const sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf-8'));
      if (sidecar?.lockedDefault) {
        sidecarLockedDefault = { preset: sidecar.lockedDefault };
      }
    } catch {
      // bad sidecar — fall through
    }
  }

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
    source: 'recompiled-from-frontmatter',
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
