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

  const computed = computeThresholds(
    config.linesOfCode ?? 0,
    config.thresholdProfile ?? "fixed",
    config.governanceLevel,
  );

  const data = {
    ...config,
    coverageThreshold:
      config.thresholds?.lineCoverage ?? computed.coverageThreshold,
    coverageEnabled: computed.coverageEnabled,
    mutationEnabled: computed.mutationEnabled,
    mutationThreshold:
      config.thresholds?.mutationScore ?? computed.mutationThreshold,
  } as unknown as Record<string, unknown>;

  const scriptPath = resolvedPath(base, "scripts", "check-all.mjs");
  results.push(
    writeFile(scriptPath, renderTemplate("scripts/check-all.mjs.ejs", data), {
      skipIfExists: true,
    }),
  );

  results.push(
    writeFile(
      resolvedPath(base, "scripts", "check-workflow-runners.mjs"),
      renderTemplate("scripts/check-workflow-runners.mjs.ejs", data),
      { skipIfExists: true },
    ),
  );

  return { files: results };
}
