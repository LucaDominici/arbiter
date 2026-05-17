<!-- api-snapshot hash:2d478871b534dd93 -->

```typescript
export interface Invariant { id: string tier: InvariantTier title: string description: string languages?: Language[] languageDetail?: Partial<Record<Language, string>> minGovernanceLevel?: GovernanceLevel alwaysActive: boolean enforcement?: string status?: 'active' | 'retired' retiredReason?: string redirectTo?: string selfOnly?: boolean }
export type { Invariant, InvariantTier, InvariantPreset } from './types.js'
export type { InvariantTier, InvariantPreset }
export type { Language, GovernanceLevel } from '../wizard/types.js'
export { INVARIANT_CATALOG } from './catalog.js'
export { getFilteredInvariants, getInvariantsByTier, presetToTiers, defaultPresetForLevel, } from './filter.js'
```
