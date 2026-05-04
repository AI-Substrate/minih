/**
 * Permissions catalog — Plan 018 R2 (T-R2.1).
 *
 * Source-of-truth for `minih agent permissions list-available` output.
 * Pure: no IO, returns plain data; CLI command formats.
 */

import type {
  PermissionDecision,
  PermissionKind,
  PermissionPresetName,
} from './policy.js';
import { ALL_PERMISSION_KINDS } from './policy.js';
import { getPreset, listPresetNames } from './presets.js';

const PRESET_DESCRIPTIONS: Record<PermissionPresetName, string> = {
  yolo: 'Allow everything. Legacy default — flips to restricted at R6.',
  trusted:
    'Allow shell, write, read, mcp, url. Deny custom-tool, memory, hook. Suitable for build/lint agents.',
  restricted:
    'Allow read + mcp only. Deny shell, write, url. Suitable for review agents.',
  'read-only':
    'Allow read + mcp only (alias of restricted). Suitable for read-only inspectors.',
  network:
    'Restricted + url:allow. Suitable for agents that fetch documentation.',
  'build-only':
    'Allow shell, write, read. Deny mcp, url. Suitable for sandboxed builds.',
};

export interface PresetCatalogEntry {
  name: PermissionPresetName;
  description: string;
  decisions: Record<PermissionKind, PermissionDecision>;
}

export function buildPresetCatalog(): PresetCatalogEntry[] {
  return listPresetNames().map((name) => ({
    name,
    description: PRESET_DESCRIPTIONS[name],
    decisions: { ...getPreset(name) },
  }));
}

/**
 * Pretty-print a catalog as a markdown table for the CLI human surface.
 * `--json` callers should use `buildPresetCatalog()` directly.
 */
export function formatCatalogAsTable(catalog: PresetCatalogEntry[]): string {
  const headers = ['Preset', ...ALL_PERMISSION_KINDS];
  const rows = catalog.map((entry) => [
    entry.name,
    ...ALL_PERMISSION_KINDS.map((k) => decisionGlyph(entry.decisions[k])),
  ]);
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length)),
  );
  const fmt = (cells: string[]): string =>
    cells.map((c, i) => c.padEnd(widths[i])).join(' | ');
  return [
    fmt(headers),
    widths.map((w) => '-'.repeat(w)).join('-+-'),
    ...rows.map(fmt),
  ].join('\n');
}

function decisionGlyph(d: PermissionDecision): string {
  switch (d) {
    case 'allow':
      return '✅';
    case 'deny':
      return '❌';
    case 'prompt-user':
      return '🟡';
  }
}
