import { renderTemplate } from "../utils/render.js";
import { writeFile, resolvedPath } from "../utils/fs.js";
import { getTestPyramidProfile } from "../config/test-pyramid-profiles.js";
import type { ProjectConfig } from "../wizard/types.js";
import type { WriteResult } from "../utils/fs.js";

export interface TestTaxonomyResult {
  files: WriteResult[];
}

/**
 * Generate docs/TEST_TAXONOMY.md for the project.
 * Pre-computes the archetype's test pyramid profile and passes it as
 * explicit template data — the EJS template never defines its own profile data.
 * skipIfExists: teams may want to customise the taxonomy after init.
 */
export function generateTestTaxonomy(
  config: ProjectConfig,
): TestTaxonomyResult {
  const profile = getTestPyramidProfile(config.archetype);
  const path = resolvedPath(config.targetDir, "docs", "TEST_TAXONOMY.md");
  const content = renderTemplate("root/TEST_TAXONOMY.md.ejs", {
    ...(config as unknown as Record<string, unknown>),
    levels: profile.levels,
    hasContainerIntegration: profile.hasContainerIntegration,
    hasPropertyTests: profile.hasPropertyTests,
    hasE2ETests: profile.hasE2ETests,
  });
  return {
    files: [writeFile(path, content, { skipIfExists: true })],
  };
}
