import { renderTemplate } from "../utils/render.js";
import { writeFile, resolvedPath } from "../utils/fs.js";
import type { ProjectConfig } from "../wizard/types.js";
import type { WriteResult } from "../utils/fs.js";

export interface DebtGatesGeneratorResult {
  files: WriteResult[];
}

function javaDebtGateFiles(base: string): [string, string][] {
  return [
    [
      resolvedPath(base, "config", "pmd-ruleset.xml"),
      "debt-gates/pmd-ruleset.xml.ejs",
    ],
    [
      resolvedPath(base, "config", "checkstyle.xml"),
      "debt-gates/checkstyle.xml.ejs",
    ],
    [
      resolvedPath(base, "config", "spotbugs-exclude.xml"),
      "debt-gates/spotbugs-exclude.xml.ejs",
    ],
    [resolvedPath(base, "spotless.gradle"), "debt-gates/spotless.gradle.ejs"],
    [
      resolvedPath(base, "config", "pitest-setup.md"),
      "debt-gates/pitest-setup.md.ejs",
    ],
    [resolvedPath(base, "spotbugs.gradle"), "debt-gates/spotbugs.gradle.ejs"],
  ];
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
    results.push(
      writeFile(
        resolvedPath(base, ".eslintrc-static.json"),
        renderTemplate("debt-gates/eslintrc-static.json.ejs", data),
        { skipIfExists: true },
      ),
    );
    results.push(
      writeFile(
        resolvedPath(base, ".prettierrc.json"),
        renderTemplate("debt-gates/prettierrc.json.ejs", data),
        { skipIfExists: true },
      ),
    );
  }

  if (config.language === "rust") {
    results.push(
      writeFile(
        resolvedPath(base, "rustfmt.toml"),
        renderTemplate("debt-gates/rustfmt.toml.ejs", data),
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
    for (const [path, tmpl] of javaDebtGateFiles(base)) {
      results.push(
        writeFile(path, renderTemplate(tmpl, data), { skipIfExists: true }),
      );
    }
  }

  if (config.language === "python") {
    results.push(
      writeFile(
        resolvedPath(base, "ruff.toml"),
        renderTemplate("debt-gates/ruff.toml.ejs", data),
        { skipIfExists: true },
      ),
    );
  }

  return { files: results };
}
