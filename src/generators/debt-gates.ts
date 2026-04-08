import { renderTemplate } from "../utils/render.js";
import { writeFile, resolvedPath } from "../utils/fs.js";
import type { ProjectConfig } from "../wizard/types.js";
import type { WriteResult } from "../utils/fs.js";

export interface DebtGatesGeneratorResult {
  files: WriteResult[];
}

export function generateDebtGates(
  config: ProjectConfig,
): DebtGatesGeneratorResult {
  if (!config.enableDebtGates) return { files: [] };

  const results: WriteResult[] = [];
  const base = config.targetDir;
  const data = config as unknown as Record<string, unknown>;

  if (config.language === "typescript") {
    results.push(
      writeFile(
        resolvedPath(base, "knip.json"),
        renderTemplate("debt-gates/knip.json.ejs", data),
        { skipIfExists: true },
      ),
    );
  }

  if (config.language === "go") {
    results.push(
      writeFile(
        resolvedPath(base, ".golangci.yml"),
        renderTemplate("debt-gates/.golangci.yml.ejs", data),
        { skipIfExists: true },
      ),
    );
  }

  if (config.language === "java") {
    results.push(
      writeFile(
        resolvedPath(base, "config", "pmd-ruleset.xml"),
        renderTemplate("debt-gates/pmd-ruleset.xml.ejs", data),
        { skipIfExists: true },
      ),
    );
    results.push(
      writeFile(
        resolvedPath(base, "config", "pitest-setup.md"),
        renderTemplate("debt-gates/pitest-setup.md.ejs", data),
        { skipIfExists: true },
      ),
    );
  }

  return { files: results };
}
