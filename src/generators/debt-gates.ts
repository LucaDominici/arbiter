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
        renderTemplate("static-analysis/knip.json.ejs", data),
        { skipIfExists: true },
      ),
    );
    results.push(
      writeFile(
        resolvedPath(base, ".eslintrc-static.json"),
        renderTemplate("static-analysis/eslintrc-static.json.ejs", data),
        { skipIfExists: true },
      ),
    );
    results.push(
      writeFile(
        resolvedPath(base, ".prettierrc.json"),
        renderTemplate("static-analysis/prettierrc.json.ejs", data),
        { skipIfExists: true },
      ),
    );
  }

  if (config.language === "go") {
    results.push(
      writeFile(
        resolvedPath(base, ".golangci.yml"),
        renderTemplate("static-analysis/.golangci.yml.ejs", data),
        { skipIfExists: true },
      ),
    );
  }

  if (config.language === "java") {
    results.push(
      writeFile(
        resolvedPath(base, "config", "pmd-ruleset.xml"),
        renderTemplate("static-analysis/pmd-ruleset.xml.ejs", data),
        { skipIfExists: true },
      ),
    );
    results.push(
      writeFile(
        resolvedPath(base, "config", "checkstyle.xml"),
        renderTemplate("static-analysis/checkstyle.xml.ejs", data),
        { skipIfExists: true },
      ),
    );
    results.push(
      writeFile(
        resolvedPath(base, "config", "spotbugs-exclude.xml"),
        renderTemplate("static-analysis/spotbugs-exclude.xml.ejs", data),
        { skipIfExists: true },
      ),
    );
    results.push(
      writeFile(
        resolvedPath(base, "spotless.gradle"),
        renderTemplate("static-analysis/spotless.gradle.ejs", data),
        { skipIfExists: true },
      ),
    );
    results.push(
      writeFile(
        resolvedPath(base, "config", "pitest-setup.md"),
        renderTemplate("mutation/pitest-l2-setup.md.ejs", data),
        { skipIfExists: true },
      ),
    );
    results.push(
      writeFile(
        resolvedPath(base, "spotbugs.gradle"),
        renderTemplate("static-analysis/spotbugs.gradle.ejs", data),
        { skipIfExists: true },
      ),
    );
  }

  if (config.language === "python") {
    results.push(
      writeFile(
        resolvedPath(base, "ruff.toml"),
        renderTemplate("static-analysis/ruff.toml.ejs", data),
        { skipIfExists: true },
      ),
    );
  }

  return { files: results };
}
