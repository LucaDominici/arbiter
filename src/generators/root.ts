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
      renderTemplate("root/editorconfig", data),
      { skipIfExists: true },
    ),
  );

  return { files: results };
}
