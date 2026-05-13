/**
 * Cross-repo governance comparison model (#264).
 *
 * Defines the finding types produced by the detectors. Each finding
 * references the INV (or ADR) id that triggered it, plus a list of
 * repo labels and a human-readable summary.
 */

/**
 * Finding types:
 *
 * - divergent-enforcement   Same INV id, but different gate mechanisms across repos
 * - contradictory-adr       Same ADR id but titles/status conflict between repos
 * - promotion-asymmetry     INV present in one repo, no INV node in another
 * - unique-to-one-repo      An invariant/node kind only appears in one repo
 * - risk-class-divergence   Same surface, different risk-class / tier
 */
export type FindingType =
  | 'divergent-enforcement'
  | 'contradictory-adr'
  | 'promotion-asymmetry'
  | 'unique-to-one-repo'
  | 'risk-class-divergence'

export interface CompareFinding {
  readonly type: FindingType
  /** Primary node id involved (e.g. "INV-04", "ADR-01"). */
  readonly invId: string
  /** Short human-readable summary. */
  readonly summary: string
  /** Repo paths involved in this finding. */
  readonly repos: readonly string[]
  /** Optional detail lines for the markdown report. */
  readonly detail?: readonly string[]
}

/** Per-repo data loaded for comparison. */
export interface RepoData {
  readonly path: string
  /** Display label (last dir segment or path). */
  readonly label: string
  /** The INV node ids present in this repo. */
  readonly invIds: ReadonlySet<string>
  /**
   * Map from INV id → set of gate mechanism labels enforcing it.
   * Empty set = orphan (exists but no enforces edges).
   */
  readonly invGates: ReadonlyMap<string, ReadonlySet<string>>
  /**
   * Map from ADR id → title string (for contradiction detection).
   */
  readonly adrTitles: ReadonlyMap<string, string>
  /**
   * Map from INV id → tier (risk class).
   */
  readonly invTiers: ReadonlyMap<string, string>
  /** True if this repo had no graph.json — loaded from INV catalog fallback. */
  readonly fromFallback: boolean
}

/** Workspace spec parsed from YAML (--workspace flag). */
export interface WorkspaceSpec {
  readonly name: string
  readonly repos: readonly WorkspaceRepo[]
}

export interface WorkspaceRepo {
  readonly path: string
  readonly role?: string | undefined
  readonly tier?: string | undefined
}
