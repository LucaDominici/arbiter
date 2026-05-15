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

function matchesLanguage(inv: Invariant, language: Language): boolean {
  if (!inv.languages) return true
  if (inv.languages.includes(language)) return true
  // multi-language projects match invariants scoped to java or typescript
  return (
    language === 'multi' && (inv.languages.includes('java') || inv.languages.includes('typescript'))
  )
}

export function getFilteredInvariants(config: {
  language: Language
  governanceLevel: GovernanceLevel
  invariantTiers: InvariantTier[]
  /** When false (default), selfOnly invariants are excluded — they apply only to arbiter itself. */
  selfMode?: boolean
}): Invariant[] {
  return INVARIANT_CATALOG.filter((inv) => {
    if (inv.selfOnly && !config.selfMode) return false
    if (!matchesLanguage(inv, config.language)) return false
    if (inv.alwaysActive) {
      return meetsGovernanceLevel(inv.minGovernanceLevel, config.governanceLevel)
    }
    if (!meetsGovernanceLevel(inv.minGovernanceLevel, config.governanceLevel)) return false
    if (!config.invariantTiers.includes(inv.tier)) return false
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
