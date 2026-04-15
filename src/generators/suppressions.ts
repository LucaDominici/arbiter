import { renderTemplate } from "../utils/render.js";
import { writeFile, resolvedPath } from "../utils/fs.js";
import type { ProjectConfig } from "../wizard/types.js";
import type { WriteResult } from "../utils/fs.js";

export interface SuppressionsGeneratorResult {
  files: WriteResult[];
}

export function generateSuppressions(
  config: ProjectConfig,
): SuppressionsGeneratorResult {
  if (!config.enableSuppressions) return { files: [] };

  const base = config.targetDir;
  const data = config as unknown as Record<string, unknown>;

  return {
    files: [
      writeFile(
        resolvedPath(base, "suppressions", "dependency-check-suppressions.xml"),
        renderTemplate(
          "suppressions/dependency-check-suppressions.xml.ejs",
          data,
        ),
        { skipIfExists: false },
      ),
      writeFile(
        resolvedPath(base, "suppressions", ".gitleaksignore"),
        renderTemplate("suppressions/gitleaksignore.ejs", data),
        { skipIfExists: false },
      ),
      writeFile(
        resolvedPath(base, "suppressions", "pii-allowlist.json"),
        renderTemplate("suppressions/pii-allowlist.json.ejs", data),
        { skipIfExists: false },
      ),
      writeFile(
        resolvedPath(base, "suppressions", "archunit-baseline.json"),
        renderTemplate("suppressions/archunit-baseline.json.ejs", data),
        { skipIfExists: false },
      ),
      writeFile(
        resolvedPath(base, "suppressions", "suppressions-schema.json"),
        renderTemplate("suppressions/suppressions-schema.json.ejs", data),
        { skipIfExists: false },
      ),
      writeFile(
        resolvedPath(base, "scripts", "check-suppressions.mjs"),
        renderTemplate("scripts/check-suppressions.mjs.ejs", data),
        { skipIfExists: false },
      ),
    ],
  };
}
