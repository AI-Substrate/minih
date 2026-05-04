/**
 * Public types for the agent-pack module — the install/upgrade/info/list
 * surface backed by a baked-in registry of GitHub URL pointers + raw URLs.
 *
 * Design references:
 * - docs/plans/017-agent-pack-install/agent-pack-install-spec.md
 * - docs/plans/017-agent-pack-install/workshops/001-cli-shape.md
 *
 * All types are stable for v1; `schemaVersion` literals and the `version`
 * field on the registry catalog let us evolve without breaking existing
 * installed packs (forward-compat per Plan-Level Risk: registry shape drift).
 */

/**
 * Per-file entry in an agent's manifest. The pack ships exactly the files
 * listed here — anything else in the source tree is ignored on install.
 */
export interface AgentPackManifestFile {
  /** Path relative to the agent root. Must be path-traversal-safe. */
  path: string;
  /** One-line human-readable description, surfaced in `minih agent info`. */
  description: string;
}

/**
 * `agent.json` — the per-agent manifest authored at the source repo and
 * fetched alongside `prompt.md` at install time. v1 fields are minimal but
 * align with both Claude Code Plugin Marketplace `plugin.json` and AWS ARA
 * package format for future interop.
 */
export interface AgentPackManifest {
  /** Stable identity. Conventionally matches the install slug. */
  name: string;
  /** Semver-style; surfaced in `agent info` as `manifestVersion`. */
  version: string;
  /** One-paragraph human-readable description. */
  description: string;
  /** Optional author/owner attribution. */
  author?: string;
  /** Optional discovery tags. */
  tags?: string[];
  /** Optional minimum minih CLI version (semver range). */
  minihVersion?: string;
  /** Always 'minih-agent' for v1; reserved for future artifact types. */
  type?: 'minih-agent';
  /** The complete pack contents. `prompt.md` MUST be present. */
  files: AgentPackManifestFile[];
  /**
   * Plan 018 R3 (manifest 0.2.0) — recommended permissions for new
   * installs. The interactive `[A]ccept / [F]allback / [Y]olo / [C]ancel`
   * prompt at install time consults these fields. When absent, install
   * falls through to the release default with `lockedDefaultReason:
   * 'minih-default'`.
   */
  permissions?: {
    /** Preset name to recommend on install. */
    recommended?: string;
    /** Preset to use if user picks `[F]allback`. Defaults to `'yolo'`. */
    fallback?: string;
    /** Free-form explanation surfaced in the install prompt. */
    rationale?: string;
  };
}

/**
 * Where a locally-installed agent came from. Embedded in `.minih-source.json`
 * after every install so `agent info` and re-install-as-upgrade can resolve
 * the same source again.
 *
 * Discriminated union by `type`:
 *   - `'registry'` — install resolved a slug via the bundled catalog.
 *     `registrySlug` is set so re-install can re-resolve through the catalog
 *     (lets us change the registry's url/ref/subpath over time).
 *   - `'url'` — install resolved a raw user-provided git URL (no registry hit).
 *   - `'local'` — install copied from a local filesystem path. No `ref` or
 *     `commitSha` — drift is detected via per-file checksums in the sidecar.
 */
export type AgentPackSource =
  | {
      type: 'registry';
      registrySlug: string;
      url: string;
      ref: string;
      subpath?: string;
      commitSha: string;
    }
  | {
      type: 'url';
      url: string;
      ref: string;
      subpath?: string;
      commitSha: string;
    }
  | {
      type: 'local';
      /** Absolute filesystem path the install copied from. */
      localPath: string;
      /** ISO-8601 timestamp the local source was last resolved (for `info` display). */
      resolvedAt: string;
    };

/**
 * `.minih-source.json` — the install-time provenance sidecar. One per
 * installed agent folder. Load-bearing for re-install-as-upgrade flow.
 *
 * `schemaVersion` is `'1'` from day 1; reader tolerates unknown fields for
 * forward-compat; writer always emits the current schema.
 */
export interface MinihSourceSidecar {
  schemaVersion: '1';
  /** The installed slug (folder name under agentsDir). May differ from `source.registrySlug` if user passed `--as`. */
  slug: string;
  source: AgentPackSource;
  /** ISO-8601 timestamp of the install/upgrade that wrote this sidecar. */
  installedAt: string;
  /** Mirror of `agent.json#version` at install time, for upgrade-diff display. */
  manifestVersion: string;
  /**
   * Per-file sha256 hex digest, keyed by manifest-relative path. Powers
   * drift detection in `agent info` and surgical-sync diffing on upgrade.
   */
  fileChecksums: Record<string, string>;
  /**
   * Plan 018 R3 (T-R3.2) — install-time-locked permissions default. Sticky
   * for the lifetime of this install; NEVER overwritten by later releases
   * (workshop 003 lossless-preservation invariant).
   *
   * Resolution chain consults this BEFORE `minihReleaseDefault` so an agent
   * installed under R3 (yolo) keeps that policy even after the R6 universal
   * flip to `restricted`. The only legitimate path to changing
   * `lockedDefault` is an explicit user `agent install` upgrade or the
   * deferred FX001 `agent permissions reset` command.
   */
  lockedDefault?: string;
  /** ISO-8601 timestamp of when `lockedDefault` was first written. */
  lockedDefaultRecordedAt?: string;
  /**
   * Why this `lockedDefault` was chosen. Workshop 003 § Q3 enumerates the
   * canonical reason strings:
   *   - 'pre-schema-install-grandfathered'  (one-time backfill)
   *   - 'manifest-recommended'              (R3+ install accepted recommendation)
   *   - 'manifest-fallback'                 (R3+ install declined recommendation)
   *   - 'minih-default'                     (R3+ install with no manifest recommendation)
   *   - 'user-override'                     (user passed --permissions to install)
   */
  lockedDefaultReason?: string;
}

/**
 * Catalog entry — one row in `dist/templates/agents-registry.json`.
 */
export interface RegistryEntry {
  /** Install slug; resolved via `minih agent install <slug>`. */
  slug: string;
  /** Source URL; `github:owner/repo` shorthand or full HTTPS. */
  url: string;
  /** Default ref (branch/tag/sha). */
  ref: string;
  /** Optional subpath inside the repo. */
  subpath?: string;
  /** One-line description; surfaced in `agent list --available`. */
  description: string;
  /** Optional discovery tags. */
  tags?: string[];
  /** minih version when this entry was added (informational). */
  since?: string;
  /** Optional minimum minih CLI version (semver range). */
  minihVersion?: string;
}

/**
 * The bundled registry catalog. Lives at `src/templates/agents-registry.json`,
 * copied to `dist/templates/agents-registry.json` by the build.
 */
export interface RegistryCatalog {
  /** Catalog format version. v1 = `'1'`. Unknown values are a loud error. */
  version: '1';
  agents: RegistryEntry[];
}

/**
 * What `installAgentPack` actually did. Surfaced in the JSON envelope's
 * `data.action` field so scripts can branch on outcome.
 */
export type InstallAction =
  | 'installed' // fresh install (no prior agent folder)
  | 'upgraded' // existing install with mismatched commit sha; files swapped
  | 'unchanged' // existing install with matching commit sha; no-op
  | 'removed'; // (returned by `removeAgentPack`)

/**
 * Result of parsing a user-supplied install reference (registry slug
 * resolution, npm-style shorthand, or full HTTPS URL).
 */
export type ParsedAgentUrl =
  | {
      type: 'github';
      owner: string;
      repo: string;
      ref: string;
      subpath?: string;
      raw: string;
    }
  | {
      type: 'https';
      origin: string;
      owner: string;
      repo: string;
      ref: string;
      subpath?: string;
      raw: string;
    }
  | {
      type: 'local';
      path: string;
      raw: string;
    };
