import { renderTemplate } from "../utils/render.js";
import { writeFile, resolvedPath } from "../utils/fs.js";
import type { ProjectConfig } from "../wizard/types.js";
import type { WriteResult } from "../utils/fs.js";

export interface EvidenceRetentionResult {
  files: WriteResult[];
}

export function generateEvidenceRetention(
  config: ProjectConfig,
): EvidenceRetentionResult {
  const base = config.targetDir;
  const data = {
    ...config,
    // Provide defaults so EJS template never sees undefined
    evidenceRetention: config.evidenceRetention ?? {
      mode: "local-last-N",
      count: 5,
    },
  } as unknown as Record<string, unknown>;

  return {
    files: [
      // Arbiter-managed rotation script — always regenerate to pick up changes
      writeFile(
        resolvedPath(base, "scripts", "evidence-rotate.mjs"),
        renderTemplate("scripts/evidence-rotate.mjs.ejs", data),
        { skipIfExists: false },
      ),
      // Seed .gitignore with common entries + .evidence/ — skip if user already has one
      writeFile(
        resolvedPath(base, ".gitignore"),
        renderTemplate("root/.gitignore.ejs", data),
        { skipIfExists: true },
      ),
    ],
  };
}
