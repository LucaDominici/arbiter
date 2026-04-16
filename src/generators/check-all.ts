import { renderTemplate } from "../utils/render.js";
import { writeFile, resolvedPath } from "../utils/fs.js";
import { computeThresholds } from "../config/thresholds.js";
import type { ProjectConfig } from "../wizard/types.js";
import type { WriteResult } from "../utils/fs.js";

export interface CheckAllGeneratorResult {
  files: WriteResult[];
}

export function generateCheckAll(
  config: ProjectConfig,
): CheckAllGeneratorResult {
  const results: WriteResult[] = [];
  const base = config.targetDir;

  const thresholds = computeThresholds(
    config.linesOfCode ?? 0,
    config.thresholdProfile ?? "fixed",
    config.governanceLevel,
  );

  const data = {
    ...config,
    // Pre-computed threshold values consumed by check-all.mjs.ejs
    coverageThreshold: thresholds.coverageThreshold,
    coverageEnabled: thresholds.coverageEnabled,
    mutationEnabled: thresholds.mutationEnabled,
  } as unknown as Record<string, unknown>;

  const scriptPath = resolvedPath(base, "scripts", "check-all.mjs");
  results.push(
    writeFile(scriptPath, renderTemplate("scripts/check-all.mjs.ejs", data), {
      skipIfExists: true,
    }),
  );

  return { files: results };
}
