import { relative } from "node:path";
import { renderTemplate } from "../utils/render.js";
import { resolvedPath } from "../utils/fs.js";
import {
  DEFAULT_VAULT_OPTIONS,
  writeVaultOutput,
  type ObsidianVaultOptions,
} from "./obsidian-vault-io.js";
import { detectModules, type DetectedModule } from "../detectors/modules.js";
import type { ProjectConfig } from "../wizard/types.js";
import type { WriteResult } from "../utils/fs.js";

export interface ModuleNotesResult {
  files: WriteResult[];
}

interface ModuleViewModel {
  name: string;
  slug: string;
  kind: DetectedModule["kind"];
  language: DetectedModule["language"];
  path: string;
  relPath: string;
}

function slugify(name: string): string {
  return name
    .replace(/^@/, "")
    .replace(/[/\\]/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .toLowerCase();
}

function toViewModel(
  modules: DetectedModule[],
  targetDir: string,
): ModuleViewModel[] {
  return modules.map((m) => ({
    name: m.name,
    slug: slugify(m.name),
    kind: m.kind,
    language: m.language,
    path: m.path,
    relPath: relative(targetDir, m.path) || ".",
  }));
}

export function generateModuleNotes(
  config: ProjectConfig,
  opts: ObsidianVaultOptions = DEFAULT_VAULT_OPTIONS,
): ModuleNotesResult {
  const base = resolvedPath(config.targetDir, "docs", "vault");
  const modules = toViewModel(
    detectModules(config.targetDir, config.language),
    config.targetDir,
  );

  const files: WriteResult[] = [];

  for (const m of modules) {
    files.push(
      writeVaultOutput(
        resolvedPath(base, "architecture", "modules", `${m.slug}.md`),
        renderTemplate("obsidian-vault/architecture/modules/module.md.ejs", {
          module: m,
        }),
        opts,
      ),
    );
  }

  const sharedData = {
    ...(config as unknown as Record<string, unknown>),
    modules,
  };

  files.push(
    writeVaultOutput(
      resolvedPath(base, "architecture", "modules", "_index.md"),
      renderTemplate(
        "obsidian-vault/architecture/modules/_index.md.ejs",
        sharedData,
      ),
      opts,
    ),
  );

  files.push(
    writeVaultOutput(
      resolvedPath(base, "architecture", "stack.md"),
      renderTemplate("obsidian-vault/architecture/stack.md.ejs", sharedData),
      opts,
    ),
  );

  files.push(
    writeVaultOutput(
      resolvedPath(base, "architecture", "dependencies.md"),
      renderTemplate(
        "obsidian-vault/architecture/dependencies.md.ejs",
        sharedData,
      ),
      opts,
    ),
  );

  return { files };
}
