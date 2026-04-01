import { execFileSync } from "node:child_process";
import { renderTemplate } from "../utils/render.js";
import { writeFile, resolvedPath } from "../utils/fs.js";
import type { ProjectConfig } from "../wizard/types.js";
import type { WriteResult } from "../utils/fs.js";

export interface CheckAllGeneratorResult {
  files: WriteResult[];
}

export function generateCheckAll(
  config: ProjectConfig,
): CheckAllGeneratorResult {
  const results: WriteResult[] = [];
  const base = config.targetDir;
  const data = config as unknown as Record<string, unknown>;

  const scriptPath = resolvedPath(base, "scripts", "check-all.sh");
  const result = writeFile(
    scriptPath,
    renderTemplate("scripts/check-all.sh.ejs", data),
    { skipIfExists: true },
  );
  results.push(result);

  // Make executable if we just created it
  if (result.action === "created") {
    chmodScript(scriptPath);
  }

  return { files: results };
}

function chmodScript(path: string): void {
  try {
    execFileSync("chmod", ["+x", path], { stdio: "ignore" });
  } catch {
    // Non-fatal
  }
}
