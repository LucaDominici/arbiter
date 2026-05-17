// SPDX-License-Identifier: Apache-2.0
import type { Language, GovernanceLevel } from '../wizard/types.js'
import type { Invariant, InvariantTier, InvariantPreset } from './types.js'
import { INVARIANT_CATALOG } from './catalog.js'

const LEVEL_ORDER: GovernanceLevel[] = ['L1', 'L2', 'L3']

function meetsGovernanceLevel(
  required: GovernanceLevel | undefined,
  actual: GovernanceLevel,
): boolean {
  if (!required) return true
  return LEVEL_ORDER.indexOf(actual) >= LEVEL_ORDER.indexOf(required)
}

export function getFilteredInvariants(config: {
  language: Language
  governanceLevel: GovernanceLevel
  invariantTiers: InvariantTier[]
  /** Include arbiter-internal invariants (selfOnly: true). Default: false (target-project context). */
  includeArbiterInternal?: boolean
  /**
   * Include viafera-port opt-in invariants (INV-62..INV-71).
   * Default: false. Enable via arbiter.json governance.invariants_catalog = 'extended'.
   */
  includeViaferaPort?: boolean
}): Invariant[] {
  return INVARIANT_CATALOG.filter((inv) => {
    // viafera-port invariants are excluded unless the caller explicitly opts in
    if (inv.optInGroup === 'viafera-port' && !config.includeViaferaPort) return false

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
      return 'full'
  }
}
