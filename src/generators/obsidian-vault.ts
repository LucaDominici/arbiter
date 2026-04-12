import { generateStaticVaultFiles } from "./obsidian-vault-static.js";
import { generateInvariantNotes } from "./obsidian-vault-invariants.js";
import { generateModuleNotes } from "./obsidian-vault-modules.js";
import {
  generateAgentsSectionedNote,
  generateImpactMap,
} from "./obsidian-vault-index.js";
import { generateGithubVaultNotes } from "./obsidian-vault-github.js";
import {
  DEFAULT_VAULT_OPTIONS,
  type ObsidianVaultOptions,
} from "./obsidian-vault-io.js";
import type { ProjectConfig } from "../wizard/types.js";
import type { WriteResult } from "../utils/fs.js";

export interface ObsidianVaultResult {
  files: WriteResult[];
}

export type { ObsidianVaultOptions } from "./obsidian-vault-io.js";

export function generateObsidianVault(
  config: ProjectConfig,
  opts: ObsidianVaultOptions = DEFAULT_VAULT_OPTIONS,
): ObsidianVaultResult {
  const files: WriteResult[] = [];

  files.push(...generateStaticVaultFiles(config, opts).files);
  files.push(...generateInvariantNotes(config, opts).files);
  files.push(...generateModuleNotes(config, opts).files);
  files.push(...generateAgentsSectionedNote(config, opts).files);
  files.push(...generateImpactMap(config, opts).files);
  files.push(...generateGithubVaultNotes(config, opts).files);

  return { files };
}
