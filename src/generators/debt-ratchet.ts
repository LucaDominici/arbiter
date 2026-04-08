import { renderTemplate } from "../utils/render.js";
import { writeFile, resolvedPath } from "../utils/fs.js";
import type { ProjectConfig } from "../wizard/types.js";
import type { WriteResult } from "../utils/fs.js";

export interface DebtRatchetGeneratorResult {
  files: WriteResult[];
}

export function generateDebtRatchet(
  config: ProjectConfig,
): DebtRatchetGeneratorResult {
  if (!config.enableDebtGates) return { files: [] };

  const base = config.targetDir;
  const data = config as unknown as Record<string, unknown>;

  return {
    files: [
      writeFile(
        resolvedPath(base, "scripts", "capture-debt-baseline.mjs"),
        renderTemplate("scripts/capture-debt-baseline.mjs.ejs", data),
        { skipIfExists: false }, // always overwrite — template evolves
      ),
      writeFile(
        resolvedPath(base, "scripts", "debt-report.mjs"),
        renderTemplate("scripts/debt-report.mjs.ejs", data),
        { skipIfExists: false },
      ),
    ],
  };
}
