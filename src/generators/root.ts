import { renderTemplate } from "../utils/render.js";
import { writeFile, resolvedPath } from "../utils/fs.js";
import type { ProjectConfig } from "../wizard/types.js";
import type { WriteResult } from "../utils/fs.js";

export interface RootGeneratorResult {
  files: WriteResult[];
}

export function generateRoot(config: ProjectConfig): RootGeneratorResult {
  const results: WriteResult[] = [];
  const base = config.targetDir;
  const data = config as unknown as Record<string, unknown>;

  // CODEOWNERS — create if missing
  if (config.githubOwner) {
    results.push(
      writeFile(
        resolvedPath(base, ".github", "CODEOWNERS"),
        renderTemplate("root/CODEOWNERS.ejs", data),
        { skipIfExists: true },
      ),
    );
  }

  // SECURITY.md — create if missing
  results.push(
    writeFile(
      resolvedPath(base, "SECURITY.md"),
      renderTemplate("root/SECURITY.md.ejs", data),
      { skipIfExists: true },
    ),
  );

  // CONTRIBUTING.md — create if missing
  results.push(
    writeFile(
      resolvedPath(base, "CONTRIBUTING.md"),
      renderTemplate("root/CONTRIBUTING.md.ejs", data),
      { skipIfExists: true },
    ),
  );

  // .editorconfig — create if missing
  results.push(
    writeFile(
      resolvedPath(base, ".editorconfig"),
      renderTemplate("root/editorconfig.ejs", data),
      { skipIfExists: true },
    ),
  );

  // tsconfig.json — TypeScript greenfield baseline (skipIfExists for brownfield)
  if (config.language === "typescript") {
    results.push(
      writeFile(
        resolvedPath(base, "tsconfig.json"),
        renderTemplate("root/tsconfig.json.ejs", data),
        { skipIfExists: true },
      ),
    );
  }

  // commitlint.config.js — conventional commit config for all projects
  results.push(
    writeFile(
      resolvedPath(base, "commitlint.config.js"),
      renderTemplate("root/commitlint.config.js.ejs", data),
      { skipIfExists: true },
    ),
  );

  return { files: results };
}
