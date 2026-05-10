import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderTemplate } from "../utils/render.js";
import { writeFile, resolvedPath } from "../utils/fs.js";
import { readFileSync } from "node:fs";
import type { ProjectConfig } from "../wizard/types.js";
import type { WriteResult } from "../utils/fs.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface CodexHooksGeneratorResult {
  files: WriteResult[];
}

export function generateCodexHooks(
  config: ProjectConfig,
): CodexHooksGeneratorResult {
  const results: WriteResult[] = [];
  const base = config.targetDir;
  const data = config as unknown as Record<string, unknown>;

  // .codex/config.toml — always rewrite so hook wiring stays current; backup preserves customizations
  results.push(
    writeFile(
      resolvedPath(base, ".codex", "config.toml"),
      renderTemplate("codex/config.toml.ejs", data),
      { backup: true },
    ),
  );

  // .codex/codex-adapter.mjs — copied from static template; skip if exists
  const adapterSrc = join(
    __dirname,
    "..",
    "templates",
    "codex",
    "codex-adapter.mjs",
  );
  results.push(
    writeFile(
      join(resolvedPath(base, ".codex"), "codex-adapter.mjs"),
      readFileSync(adapterSrc, "utf-8"),
      { skipIfExists: true },
    ),
  );

  return { files: results };
}
