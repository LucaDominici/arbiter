<!-- api-snapshot hash:031d2843004b81f5 -->

```typescript
export interface Invariant { id: string tier: InvariantTier title: string description: string languages?: Language[] languageDetail?: Partial<Record<Language, string>> minGovernanceLevel?: GovernanceLevel alwaysActive: boolean enforcement?: string adr?: string status?: 'active' | 'retired' retiredReason?: string redirectTo?: string selfOnly?: boolean optInGroup?: 'extended' migrationStatus?: 'baseline' | 'transition' | 'complete' minPresent?: number }
export type { Invariant, InvariantTier, InvariantPreset } from './types.js'
export type { InvariantTier, InvariantPreset }
export type { Language, GovernanceLevel } from '../wizard/types.js'
export { INVARIANT_CATALOG } from './catalog.js'
export { getFilteredInvariants, getInvariantsByTier, presetToTiers, defaultPresetForLevel, } from './filter.js'
```
