// SPDX-License-Identifier: Apache-2.0
import type { Language, GovernanceLevel } from '../wizard/types.js'
import type { Invariant, InvariantTier, InvariantPreset } from './types.js'
import { INVARIANT_CATALOG } from './catalog.js'
import { levelAtLeast } from '../config/levels.js'

function meetsGovernanceLevel(
  required: GovernanceLevel | undefined,
  actual: GovernanceLevel,
): boolean {
  if (!required) return true
  return levelAtLeast(actual, required)
}

export function getFilteredInvariants(config: {
  language: Language
  governanceLevel: GovernanceLevel
  invariantTiers: InvariantTier[]
  /** Include arbiter-internal invariants (selfOnly: true). Default: false (target-project context). */
  includeArbiterInternal?: boolean
  /**
   * Include extended opt-in invariants (INV-62..INV-71).
   * Default: false. Enable via arbiter.json governance.invariants_catalog = 'extended'.
   */
  includeExtendedInvariants?: boolean
}): Invariant[] {
  return INVARIANT_CATALOG.filter((inv) => {
    // Retired tombstones (status: 'retired') are kept in the catalog only for
    // ID-stability — they enforce nothing. Never leak them into generated
    // AGENTS.md / GLOBAL_INVARIANTS.md (#1570), matching src/graph/builders/inv.ts.
    if (inv.status === 'retired') return false

    // extended invariants are excluded unless the caller explicitly opts in
    if (inv.optInGroup === 'extended' && !config.includeExtendedInvariants) return false

    // selfOnly invariants are excluded from target-project generation by default
    if (inv.selfOnly && !config.includeArbiterInternal) return false

    // Language filter: if the invariant requires specific languages, check.
    // multi-language projects match invariants scoped to java or typescript.
    if (inv.languages && !inv.languages.includes(config.language)) {
      if (
        config.language !== 'multi' ||
        (!inv.languages.includes('java') && !inv.languages.includes('typescript'))
      )
        return false
    }

    // Governance level filter
    if (!meetsGovernanceLevel(inv.minGovernanceLevel, config.governanceLevel)) return false

    // Tier filter: alwaysActive bypasses tier selection only (not governance level — checked above)
    if (!inv.alwaysActive && !config.invariantTiers.includes(inv.tier)) return false

    return true
  })
}

export function getInvariantsByTier(invariants: Invariant[]): Map<InvariantTier, Invariant[]> {
  const map = new Map<InvariantTier, Invariant[]>()
  for (const inv of invariants) {
    const existing = map.get(inv.tier) ?? []
    existing.push(inv)
    map.set(inv.tier, existing)
  }
  return map
}

export function presetToTiers(preset: InvariantPreset): InvariantTier[] {
  const base: InvariantTier[] = ['architectural', 'governance']
  switch (preset) {
    case 'essential':
      return base
    case 'standard':
      return [...base, 'data', 'operational']
    case 'full':
      return [...base, 'data', 'security', 'operational']
  }
}

export function defaultPresetForLevel(level: GovernanceLevel): InvariantPreset {
  switch (level) {
    case 'L1':
      return 'essential'
    case 'L2':
      return 'standard'
    case 'L3':
    case 'L4':
      return 'full'
  }
}
