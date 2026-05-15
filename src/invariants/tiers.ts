// SPDX-License-Identifier: Apache-2.0
import type { InvariantTier } from '../wizard/types.js'

export const TIER_LABELS: Record<InvariantTier, string> = {
  architectural: 'Tier 1: Architectural Integrity',
  data: 'Tier 2: Data Integrity',
  security: 'Tier 3: Security & Compliance',
  operational: 'Tier 4: Operational Excellence',
  governance: 'Tier 5: Governance',
}
