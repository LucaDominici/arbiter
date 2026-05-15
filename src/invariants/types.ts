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
   * Required for every entry in `languages` when languages is set.
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
}
