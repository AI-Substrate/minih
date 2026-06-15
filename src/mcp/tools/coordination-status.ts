/**
 * Plan 027 Phase 4 (#36) — `coordination_status` MCP tool.
 *
 * Always-allowed inside tool. Returns the companion's derived lifecycle ledger
 * + a strict-validated draft farewell + the pinned `coordinationMode`, so a
 * coordinated agent can self-introspect ("where am I in my lifecycle?") without
 * firing a request. Mirrors `permission-status.ts`: the handler takes only the
 * context and returns `{ content, structuredContent }`.
 *
 * Reads the SAME pure `deriveCompanionLedger` runner deriver that the outside
 * `minih companion status` CLI verb uses, so the two surfaces never diverge.
 */

import {
  buildDraftFarewell,
  type CompanionDraftFarewell,
  type CompanionLedger,
  CompanionLedgerError,
  coordinationRunLocation,
  deriveCompanionLedger,
  readIdleBudgetMs,
} from '../../runner/index.js';
import type { McpServerContext } from '../context.js';
import { McpToolError, type McpToolResult } from '../types.js';

export interface CoordinationStatusResult {
  /** Slug of the agent this MCP server is serving. */
  agentSlug: string;
  /** Pinned to the binary frontmatter source (PIC-B): `'enabled' | 'disabled'`. */
  coordinationMode: 'enabled' | 'disabled';
  /** The derived companion lifecycle ledger. */
  ledger: CompanionLedger;
  /** Strict-validated draft farewell, or null when the draft failed validation. */
  draftFarewell: CompanionDraftFarewell | null;
  /**
   * Plan 027 Phase 5 (#35) — the configured idle budget in SECONDS (AC-12), read
   * off the run's recorded `run.json` `budgets.idleBudgetMs`. Lets the companion
   * discover its effective stand-down budget at runtime instead of inferring it.
   * `idleBudgetSec` (not `*Ms`) is the Phase-6 self-discovery trio name.
   */
  idleBudgetSec: number;
}

export function coordinationStatus(
  context: McpServerContext,
): McpToolResult<CoordinationStatusResult> {
  const location = coordinationRunLocation(
    context.agentSlug,
    context.agentsDir,
    context.runId,
  );

  let ledger: CompanionLedger;
  try {
    ledger = deriveCompanionLedger(location);
  } catch (err) {
    if (err instanceof CompanionLedgerError) {
      throw new McpToolError('MCP_INBOX_CORRUPT', err.message);
    }
    throw err;
  }

  const result: CoordinationStatusResult = {
    agentSlug: context.agentSlug,
    coordinationMode: ledger.coordinationMode,
    ledger,
    draftFarewell: buildDraftFarewell(ledger),
    idleBudgetSec: Math.round(readIdleBudgetMs(context.runDir) / 1000),
  };

  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    structuredContent: result,
  };
}
