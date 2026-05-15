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
   * Per-language variant of title.
   * Used instead of title when language matches.
   * Should cover every language listed in `languages`.
   */
  languageDetail?: Partial<Record<Language, string>>
  /**
   * Minimum governance level required.
   * If omitted, applies at all levels.
   */
  minGovernanceLevel?: GovernanceLevel
  /**
   * True for Tier 1 (architectural) and Tier 5 (governance) —
   * always included regardless of invariantTiers selection.
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
   * When true, this invariant applies only to arbiter itself and must not be
   * emitted into generated AGENTS.md / GLOBAL_INVARIANTS.md for target projects.
   * Use for rules that reference arbiter-internal paths (fixtures, templates, matrix).
   */
  selfOnly?: boolean
}
