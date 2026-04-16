import { renderTemplate } from "../utils/render.js";
import { writeFile, resolvedPath } from "../utils/fs.js";
import type { ProjectConfig } from "../wizard/types.js";
import type { WriteResult } from "../utils/fs.js";

export interface StrideEnforcementResult {
  files: WriteResult[];
}

export function generateStrideEnforcement(
  config: ProjectConfig,
): StrideEnforcementResult {
  const base = config.targetDir;
  const data = config as unknown as Record<string, unknown>;

  return {
    files: [
      // User-edited governance docs — skip on regeneration to preserve threat entries
      writeFile(
        resolvedPath(base, "docs", "SECURITY", "STRIDE.md"),
        renderTemplate("security/STRIDE.md.ejs", data),
        { skipIfExists: true },
      ),
      writeFile(
        resolvedPath(base, "docs", "GOVERNANCE", "RACI.md"),
        renderTemplate("governance/RACI.md.ejs", data),
        { skipIfExists: true },
      ),
      // Arbiter-managed gate script — always regenerate to pick up script changes
      writeFile(
        resolvedPath(base, "scripts", "check-stride-traceability.mjs"),
        renderTemplate("scripts/check-stride-traceability.mjs.ejs", data),
        { skipIfExists: false },
      ),
    ],
  };
}
