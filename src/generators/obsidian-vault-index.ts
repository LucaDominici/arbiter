import { renderTemplate } from "../utils/render.js";
import { writeFile, resolvedPath } from "../utils/fs.js";
import { detectModules } from "../detectors/modules.js";
import { getFilteredInvariants } from "../invariants/filter.js";
import type { ProjectConfig } from "../wizard/types.js";
import type { WriteResult } from "../utils/fs.js";
import type { Invariant } from "../invariants/types.js";

export interface IndexNoteResult {
  files: WriteResult[];
}

function slugify(name: string): string {
  return name
    .replace(/^@/, "")
    .replace(/[/\\]/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .toLowerCase();
}

export function generateAgentsSectionedNote(
  config: ProjectConfig,
): IndexNoteResult {
  const base = resolvedPath(config.targetDir, "docs", "vault");
  const data = config as unknown as Record<string, unknown>;
  return {
    files: [
      writeFile(
        resolvedPath(base, "governance", "AGENTS.md"),
        renderTemplate("obsidian-vault/governance/AGENTS.md.ejs", data),
        { skipIfExists: false },
      ),
    ],
  };
}

export function generateImpactMap(config: ProjectConfig): IndexNoteResult {
  const base = resolvedPath(config.targetDir, "docs", "vault");
  const modules = detectModules(config.targetDir, config.language).map((m) => ({
    name: m.name,
    slug: slugify(m.name),
  }));
  const invariants = getFilteredInvariants({
    language: config.language,
    governanceLevel: config.governanceLevel,
    invariantTiers: config.invariantTiers,
  });

  const invariantRows = invariants.map((inv: Invariant) => ({
    id: inv.id,
    title: inv.title,
    // POC semantics: always-active invariants map to every detected module;
    // others map to none until a future cross-reference pass refines them.
    modules: inv.alwaysActive ? modules : [],
  }));

  const moduleRows = modules.map((m) => ({
    name: m.name,
    slug: m.slug,
    invariants: invariants
      .filter((inv) => inv.alwaysActive)
      .map((inv) => ({ id: inv.id, title: inv.title })),
  }));

  return {
    files: [
      writeFile(
        resolvedPath(base, "architecture", "impact-map.md"),
        renderTemplate("obsidian-vault/architecture/impact-map.md.ejs", {
          invariantRows,
          moduleRows,
        } as unknown as Record<string, unknown>),
        { skipIfExists: false },
      ),
    ],
  };
}
