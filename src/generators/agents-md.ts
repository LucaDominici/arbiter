import { renderTemplate } from "../utils/render.js";
import { writeFile, resolvedPath } from "../utils/fs.js";
import type { ProjectConfig, InvariantTier } from "../wizard/types.js";
import type { WriteResult } from "../utils/fs.js";
import {
  getFilteredInvariants,
  getInvariantsByTier,
} from "../invariants/filter.js";

const TIER_LABELS: Record<InvariantTier, string> = {
  architectural: "Tier 1: Architectural Integrity",
  data: "Tier 2: Data Integrity",
  security: "Tier 3: Security & Compliance",
  operational: "Tier 4: Operational Excellence",
  governance: "Tier 5: Governance",
};

export function generateAgentsMd(config: ProjectConfig): WriteResult {
  const invariants = getFilteredInvariants({
    language: config.language,
    governanceLevel: config.governanceLevel,
    invariantTiers: config.invariantTiers,
  });
  const invariantsByTier = getInvariantsByTier(invariants);

  const data = {
    ...(config as unknown as Record<string, unknown>),
    invariants,
    invariantsByTier,
    tierLabels: TIER_LABELS,
  };

  const content = renderTemplate("agents-md/AGENTS.md.ejs", data);
  return writeFile(resolvedPath(config.targetDir, "AGENTS.md"), content, {
    backup: true,
  });
}
