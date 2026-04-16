import { renderTemplate } from "../utils/render.js";
import { writeFile, resolvedPath } from "../utils/fs.js";
import type { ProjectConfig } from "../wizard/types.js";
import type { WriteResult } from "../utils/fs.js";

export interface BoundariesGeneratorResult {
  files: WriteResult[];
}

export function generateRustBoundaries(
  config: ProjectConfig,
): BoundariesGeneratorResult {
  if (config.language !== "rust") return { files: [] };
  if (config.architectureStyle !== "hexagonal") return { files: [] };

  const base = config.targetDir;
  const data = config as unknown as Record<string, unknown>;

  return {
    files: [
      writeFile(
        resolvedPath(base, "deny.toml"),
        renderTemplate("boundaries/deny.toml.ejs", data),
        { skipIfExists: true },
      ),
      writeFile(
        resolvedPath(base, "clippy.toml"),
        renderTemplate("boundaries/clippy.toml.ejs", data),
        { skipIfExists: true },
      ),
      writeFile(
        resolvedPath(base, "scripts/check-boundaries.mjs"),
        renderTemplate("boundaries/check-boundaries-rust.mjs.ejs", data),
        { skipIfExists: true },
      ),
    ],
  };
}
