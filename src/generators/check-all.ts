import { renderTemplate } from "../utils/render.js";
import { writeFile, resolvedPath } from "../utils/fs.js";
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
  const data = config as unknown as Record<string, unknown>;

  const scriptPath = resolvedPath(base, "scripts", "check-all.mjs");
  results.push(
    writeFile(scriptPath, renderTemplate("scripts/check-all.mjs.ejs", data), {
      skipIfExists: true,
    }),
  );

  return { files: results };
}
