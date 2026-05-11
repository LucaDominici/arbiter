import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { renderTemplate } from "../utils/render.js";
import { writeFile, resolvedPath } from "../utils/fs.js";
import type { ProjectConfig } from "../wizard/types.js";
import type { WriteResult } from "../utils/fs.js";

export interface DebtGatesGeneratorResult {
  files: WriteResult[];
}

function injectDepCruiserPackageJson(targetDir: string): void {
  const pkgPath = resolvedPath(targetDir, "package.json");
  if (!existsSync(pkgPath)) return;
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
  } catch {
    return;
  }
  const scripts = (pkg.scripts ?? {}) as Record<string, string>;
  if (!scripts["check:arch"]) {
    scripts["check:arch"] = "depcruise src";
    pkg.scripts = scripts;
  }
  const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>;
  if (!devDeps["dependency-cruiser"]) {
    devDeps["dependency-cruiser"] = "^16.0.0";
    pkg.devDependencies = devDeps;
  }
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
}

function pushJavaDebtGates(
  results: WriteResult[],
  base: string,
  data: Record<string, unknown>,
): void {
  const files: [string, string][] = [
    [
      resolvedPath(base, "config", "pmd-ruleset.xml"),
      "static-analysis/pmd-ruleset.xml.ejs",
    ],
    [
      resolvedPath(base, "config", "checkstyle.xml"),
      "static-analysis/checkstyle.xml.ejs",
    ],
    [
      resolvedPath(base, "config", "spotbugs-exclude.xml"),
      "static-analysis/spotbugs-exclude.xml.ejs",
    ],
    [
      resolvedPath(base, "spotless.gradle"),
      "static-analysis/spotless.gradle.ejs",
    ],
    [
      resolvedPath(base, "config", "pitest-setup.md"),
      "mutation/pitest-l2-setup.md.ejs",
    ],
    [
      resolvedPath(base, "spotbugs.gradle"),
      "static-analysis/spotbugs.gradle.ejs",
    ],
    [
      resolvedPath(base, "scripts", "verify-spotbugs.mjs"),
      "scripts/verify-spotbugs.mjs.ejs",
    ],
    [
      resolvedPath(base, "spotbugs-baseline.json"),
      "scripts/spotbugs-baseline.json.ejs",
    ],
  ];
  for (const [path, tmpl] of files) {
    results.push(
      writeFile(path, renderTemplate(tmpl, data), { skipIfExists: true }),
    );
  }
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
    results.push(
      writeFile(
        resolvedPath(base, ".dependency-cruiser.cjs"),
        renderTemplate("static-analysis/.dependency-cruiser.cjs.ejs", data),
        { skipIfExists: true },
      ),
    );
    injectDepCruiserPackageJson(base);
  }

  if (config.language === "rust") {
    results.push(
      writeFile(
        resolvedPath(base, "rustfmt.toml"),
        renderTemplate("static-analysis/rustfmt.toml.ejs", data),
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
    pushJavaDebtGates(results, base, data);
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
