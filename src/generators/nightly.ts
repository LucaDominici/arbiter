import { renderTemplate } from "../utils/render.js";
import { writeFile, resolvedPath } from "../utils/fs.js";
import { computeThresholds } from "../config/thresholds.js";
import type { ProjectConfig } from "../wizard/types.js";
import type { WriteResult } from "../utils/fs.js";

export interface NightlyGeneratorResult {
  files: WriteResult[];
}

export function generateNightly(config: ProjectConfig): NightlyGeneratorResult {
  if (config.governanceLevel !== "L3") return { files: [] };

  const base = config.targetDir;

  const thresholds = computeThresholds(
    config.linesOfCode ?? 0,
    config.thresholdProfile ?? "fixed",
    config.governanceLevel,
  );

  const data = {
    ...config,
    coverageThreshold: thresholds.coverageThreshold,
    mutationThreshold: thresholds.mutationThreshold,
    k6ScriptPath: config.k6ScriptPath ?? "tests/load/default.js",
  } as unknown as Record<string, unknown>;

  return {
    files: [
      writeFile(
        resolvedPath(base, ".github", "workflows", "nightly.yml"),
        renderTemplate("github/workflows/nightly.yml.ejs", data),
        { skipIfExists: false },
      ),
      writeFile(
        resolvedPath(base, "scripts", "evidence-collect.mjs"),
        renderTemplate("scripts/evidence-collect.mjs.ejs", data),
        { skipIfExists: false },
      ),
      writeFile(
        resolvedPath(base, "scripts", "ci-classify-changes.mjs"),
        renderTemplate("scripts/ci-classify-changes.mjs.ejs", data),
        { skipIfExists: false },
      ),
      writeFile(resolvedPath(base, ".evidence", ".gitkeep"), "", {
        skipIfExists: true,
      }),
    ],
  };
}
