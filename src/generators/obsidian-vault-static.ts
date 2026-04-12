import { renderTemplate } from "../utils/render.js";
import { resolvedPath } from "../utils/fs.js";
import {
  DEFAULT_VAULT_OPTIONS,
  writeVaultOutput,
  type ObsidianVaultOptions,
} from "./obsidian-vault-io.js";
import type { ProjectConfig } from "../wizard/types.js";
import type { WriteResult } from "../utils/fs.js";

export interface StaticVaultGeneratorResult {
  files: WriteResult[];
}

const STATIC_TEMPLATES = [
  { tpl: ".obsidian/app.json.ejs", out: ".obsidian/app.json" },
  { tpl: ".obsidian/graph.json.ejs", out: ".obsidian/graph.json" },
  { tpl: "00-INDEX.md.ejs", out: "00-INDEX.md" },
  { tpl: "prd/_template.md.ejs", out: "prd/_template.md" },
  { tpl: "prd/_impact-template.md.ejs", out: "prd/_impact-template.md" },
  {
    tpl: "governance/decisions/_template.md.ejs",
    out: "governance/decisions/_template.md",
  },
] as const;

export function generateStaticVaultFiles(
  config: ProjectConfig,
  opts: ObsidianVaultOptions = DEFAULT_VAULT_OPTIONS,
): StaticVaultGeneratorResult {
  const data = config as unknown as Record<string, unknown>;
  const base = resolvedPath(config.targetDir, "docs", "vault");

  const files = STATIC_TEMPLATES.map(({ tpl, out }) =>
    writeVaultOutput(
      resolvedPath(base, ...out.split("/")),
      renderTemplate(`obsidian-vault/${tpl}`, data),
      opts,
    ),
  );

  return { files };
}
