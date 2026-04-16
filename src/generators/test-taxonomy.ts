import { renderTemplate } from "../utils/render.js";
import { writeFile, resolvedPath } from "../utils/fs.js";
import type { ProjectConfig } from "../wizard/types.js";
import type { WriteResult } from "../utils/fs.js";

export interface TestTaxonomyResult {
  files: WriteResult[];
}

/**
 * Generate docs/TEST_TAXONOMY.md for the project.
 * Branches on archetype so only relevant test levels appear.
 * skipIfExists: teams may want to customise the taxonomy after init.
 */
export function generateTestTaxonomy(
  config: ProjectConfig,
): TestTaxonomyResult {
  const path = resolvedPath(config.targetDir, "docs", "TEST_TAXONOMY.md");
  const content = renderTemplate(
    "root/TEST_TAXONOMY.md.ejs",
    config as unknown as Record<string, unknown>,
  );
  return {
    files: [writeFile(path, content, { skipIfExists: true })],
  };
}
