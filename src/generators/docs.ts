import { join } from "node:path";
import { renderTemplate } from "../utils/render.js";
import { writeFile, resolvedPath } from "../utils/fs.js";
import type { ProjectConfig } from "../wizard/types.js";
import type { WriteResult } from "../utils/fs.js";

export interface DocsGeneratorResult {
  files: WriteResult[];
}

export function generateDocs(config: ProjectConfig): DocsGeneratorResult {
  if (config.governanceLevel === "L1") {
    return { files: [] };
  }

  const results: WriteResult[] = [];
  const base = config.targetDir;
  const data = config as unknown as Record<string, unknown>;
  const adrDir = resolvedPath(base, join("docs", "adr"));

  results.push(
    writeFile(
      join(adrDir, "ADR-000_template.md"),
      renderTemplate("docs/adr/ADR-000_template.md.ejs", data),
      { skipIfExists: true },
    ),
  );

  results.push(
    writeFile(
      resolvedPath(base, "docs", "SECURE_CODING_CHECKLIST.md"),
      renderTemplate("docs/SECURE_CODING_CHECKLIST.md.ejs", data),
      { skipIfExists: true },
    ),
  );

  results.push(
    writeFile(
      resolvedPath(base, "docs", "CODING_STANDARDS.md"),
      renderTemplate("docs/CODING_STANDARDS.md.ejs", data),
      { skipIfExists: true },
    ),
  );

  results.push(
    writeFile(
      resolvedPath(base, "docs", "MASTER_TEST_PLAN.md"),
      renderTemplate("docs/MASTER_TEST_PLAN.md.ejs", data),
      { skipIfExists: true },
    ),
  );

  return { files: results };
}
