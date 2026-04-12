import type { InvariantTier } from "../wizard/types.js";

export const TIER_ORDER: InvariantTier[] = [
  "architectural",
  "data",
  "security",
  "operational",
  "governance",
];

export const TIER_LABELS: Record<InvariantTier, string> = {
  architectural: "Tier 1: Architectural Integrity",
  data: "Tier 2: Data Integrity",
  security: "Tier 3: Security & Compliance",
  operational: "Tier 4: Operational Excellence",
  governance: "Tier 5: Governance",
};

export const TIER_INDEX: Record<InvariantTier, number> = {
  architectural: 1,
  data: 2,
  security: 3,
  operational: 4,
  governance: 5,
};
