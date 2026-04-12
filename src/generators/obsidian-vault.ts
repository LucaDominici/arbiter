import { generateStaticVaultFiles } from "./obsidian-vault-static.js";
import { generateInvariantNotes } from "./obsidian-vault-invariants.js";
import { generateModuleNotes } from "./obsidian-vault-modules.js";
import {
  generateAgentsSectionedNote,
  generateImpactMap,
} from "./obsidian-vault-index.js";
import { generateGithubVaultNotes } from "./obsidian-vault-github.js";
import type { ProjectConfig } from "../wizard/types.js";
import type { WriteResult } from "../utils/fs.js";

export interface ObsidianVaultResult {
  files: WriteResult[];
}

export function generateObsidianVault(
  config: ProjectConfig,
): ObsidianVaultResult {
  const files: WriteResult[] = [];

  files.push(...generateStaticVaultFiles(config).files);
  files.push(...generateInvariantNotes(config).files);
  files.push(...generateModuleNotes(config).files);
  files.push(...generateAgentsSectionedNote(config).files);
  files.push(...generateImpactMap(config).files);
  files.push(...generateGithubVaultNotes(config).files);

  return { files };
}
