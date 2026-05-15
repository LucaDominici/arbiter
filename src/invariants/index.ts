// SPDX-License-Identifier: Apache-2.0
// Public barrel for @arbiter/cli/invariants (#598)
// Re-exports the stable public surface — do not leak internal implementation modules.
export { INVARIANT_CATALOG } from './catalog.js'
export {
  getFilteredInvariants,
  getInvariantsByTier,
  presetToTiers,
  defaultPresetForLevel,
} from './filter.js'
export type { Invariant, InvariantTier, InvariantPreset } from './types.js'
// Wizard types needed by external consumers building governance configs
export type { Language, GovernanceLevel } from '../wizard/types.js'
