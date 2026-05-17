// SPDX-License-Identifier: Apache-2.0
import type { Language, GovernanceLevel, InvariantTier, InvariantPreset } from '../wizard/types.js'

export type { InvariantTier, InvariantPreset }

export interface Invariant {
  /** Unique identifier, e.g. "INV-01" */
  id: string
  tier: InvariantTier
  /** One-liner for AGENTS.md */
  title: string
  /** Detailed explanation for GLOBAL_INVARIANTS.md */
  description: string
  /** If set, invariant only applies to these languages. Omit for all languages. */
  languages?: Language[]
  /**
   * Per-language variant of title. Used instead of title when language matches.
   *
   * `Partial<Record<Language, string>>` is intentional: the Language union is
   * broader than any single `languages` array, so requiring all keys would
   * force meaningless entries. When set, MUST cover every language declared in
   * `languages` — enforced at gate time by the catalog-parity test (#680).
   */
  languageDetail?: Partial<Record<Language, string>>
  /**
   * Minimum governance level required.
   * If omitted, applies at all levels.
   */
  minGovernanceLevel?: GovernanceLevel
  /**
   * Bypasses the invariantTiers filter — this invariant appears regardless of
   * which tiers the caller selects. minGovernanceLevel is still enforced.
   * In practice: architectural/governance rules, plus security rules at L2+
   * that must not be excluded just because a project picked a narrower preset.
   */
  alwaysActive: boolean
  /** How this invariant is enforced (e.g. "hook + CI", "CI only", "manual") */
  enforcement?: string
  /**
   * Lifecycle status. Omit (or "active") for in-use invariants.
   * Set to "retired" when an invariant is superseded or removed — IDs must never be reused.
   */
  status?: 'active' | 'retired'
  /**
   * Required when status is "retired". Explains why and what replaced this invariant.
   */
  retiredReason?: string
  /**
   * Optional: the ID of the invariant that supersedes this one.
   * Only set when status is "retired".
   */
  redirectTo?: string
  /**
   * True for invariants that only apply to arbiter's own development.
   * These are excluded from generated target-project AGENTS.md / GLOBAL_INVARIANTS.md.
   */
  selfOnly?: boolean
  /**
   * Opt-in group identifier. Invariants in a named group are excluded from
   * the default filter and only appear when the caller explicitly opts in.
   * Currently supported: 'viafera-port' (INV-62..INV-71, enabled via
   * arbiter.json governance.invariants_catalog = 'extended').
   */
  optInGroup?: 'viafera-port'
}
