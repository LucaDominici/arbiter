import { renderTemplate } from "../utils/render.js";
import { writeFile, resolvedPath } from "../utils/fs.js";
import type {
  ProjectConfig,
  InvariantTier,
  Language,
} from "../wizard/types.js";
import type { WriteResult } from "../utils/fs.js";
import {
  getFilteredInvariants,
  getInvariantsByTier,
} from "../invariants/filter.js";
import type { Invariant } from "../invariants/types.js";

export interface InvariantNotesResult {
  files: WriteResult[];
}

const TIER_LABELS: Record<InvariantTier, string> = {
  architectural: "Tier 1: Architectural Integrity",
  data: "Tier 2: Data Integrity",
  security: "Tier 3: Security & Compliance",
  operational: "Tier 4: Operational Excellence",
  governance: "Tier 5: Governance",
};

const TIER_INDEX: Record<InvariantTier, number> = {
  architectural: 1,
  data: 2,
  security: 3,
  operational: 4,
  governance: 5,
};

const TIER_ORDER: InvariantTier[] = [
  "architectural",
  "data",
  "security",
  "operational",
  "governance",
];

function resolveLanguageDetail(
  inv: Invariant,
  language: Language,
): string | null {
  if (!inv.languageDetail) return null;
  return inv.languageDetail[language] ?? inv.languageDetail.unknown ?? null;
}

export function generateInvariantNotes(
  config: ProjectConfig,
): InvariantNotesResult {
  const invariants = getFilteredInvariants({
    language: config.language,
    governanceLevel: config.governanceLevel,
    invariantTiers: config.invariantTiers,
  });
  const byTier = getInvariantsByTier(invariants);
  const base = resolvedPath(config.targetDir, "docs", "vault");

  const files: WriteResult[] = [];

  for (const invariant of invariants) {
    const data: Record<string, unknown> = {
      invariant,
      language: config.language,
      tierLabel: TIER_LABELS[invariant.tier],
      tierIndex: TIER_INDEX[invariant.tier],
      languageDetail: resolveLanguageDetail(invariant, config.language),
      modules: [] as string[],
    };
    files.push(
      writeFile(
        resolvedPath(base, "governance", "invariants", `${invariant.id}.md`),
        renderTemplate("obsidian-vault/governance/invariants/INV.md.ejs", data),
        { skipIfExists: false },
      ),
    );
  }

  const tiers = TIER_ORDER.filter((tier) => byTier.has(tier)).map((tier) => ({
    label: TIER_LABELS[tier],
    invariants: byTier.get(tier) ?? [],
  }));

  files.push(
    writeFile(
      resolvedPath(base, "governance", "invariants", "_index.md"),
      renderTemplate("obsidian-vault/governance/invariants/_index.md.ejs", {
        tiers,
      } as unknown as Record<string, unknown>),
      { skipIfExists: false },
    ),
  );

  return { files };
}
