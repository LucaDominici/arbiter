import { renderTemplate } from "../utils/render.js";
import { writeFile, resolvedPath } from "../utils/fs.js";
import { isL3Allowed } from "../utils/maturity-check.js";
import type { ProjectConfig } from "../wizard/types.js";
import type { WriteResult } from "../utils/fs.js";

export interface MutationGeneratorResult {
  files: WriteResult[];
}

const MUTATION_THRESHOLD = 85;

export function generateMutation(
  config: ProjectConfig,
): MutationGeneratorResult {
  if (config.governanceLevel !== "L3") return { files: [] };

  const { language, targetDir, acceptBetaTools = false } = config;

  const gate = isL3Allowed(language, "mutation", acceptBetaTools);
  if (!gate.allowed) {
    throw new Error(gate.errorMessage);
  }

  const data: Record<string, unknown> = {
    ...(config as unknown as Record<string, unknown>),
    mutationThreshold: MUTATION_THRESHOLD,
    basePackage: config.basePackage ?? "com.example",
    modulePath: config.projectName.replace(/-/g, "_"),
  };

  const files: WriteResult[] = [];

  if (language === "java") {
    if (config.buildTool === "maven") {
      files.push(
        writeFile(
          resolvedPath(targetDir, "docs", "mutation", "pitest-maven-setup.md"),
          renderTemplate("mutation/pitest-maven-setup.md.ejs", data),
          { skipIfExists: true },
        ),
      );
    } else {
      files.push(
        writeFile(
          resolvedPath(targetDir, "gradle", "pitest.gradle"),
          renderTemplate("mutation/pitest.gradle.ejs", data),
          { skipIfExists: true },
        ),
      );
    }
  } else if (language === "typescript") {
    files.push(
      writeFile(
        resolvedPath(targetDir, "stryker.conf.json"),
        renderTemplate("mutation/stryker.conf.json.ejs", data),
        { skipIfExists: true },
      ),
    );
  } else if (language === "rust") {
    files.push(
      writeFile(
        resolvedPath(targetDir, "cargo-mutants.toml"),
        renderTemplate("mutation/cargo-mutants.toml.ejs", data),
        { skipIfExists: true },
      ),
      writeFile(
        resolvedPath(targetDir, "scripts", "parse-mutants.mjs"),
        renderTemplate("mutation/parse-mutants.mjs.ejs", data),
        { skipIfExists: true },
      ),
    );
  } else if (language === "python") {
    files.push(
      writeFile(
        resolvedPath(targetDir, "mutmut-config.toml"),
        renderTemplate("mutation/mutmut-config.toml.ejs", data),
        { skipIfExists: true },
      ),
      writeFile(
        resolvedPath(targetDir, "scripts", "parse-mutmut.py"),
        renderTemplate("mutation/parse-mutmut.py.ejs", data),
        { skipIfExists: true },
      ),
    );
  }

  return { files };
}
