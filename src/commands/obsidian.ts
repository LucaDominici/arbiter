import { resolve, basename } from "node:path";
import { detectLanguage } from "../detectors/language.js";
import { detectBuildCommands } from "../detectors/build.js";
import {
  detectFramework,
  detectArchetypeHint,
} from "../detectors/framework.js";
import { detectGitInfo } from "../detectors/git.js";
import { detectExisting } from "../detectors/existing.js";
import { getLanguageHooks } from "../detectors/language-hooks.js";
import { loadConfig, type ArbiterConfig } from "../utils/config.js";
import { generateObsidianVault } from "../generators/obsidian-vault.js";
import { generateGithubVaultNotes } from "../generators/obsidian-vault-github.js";
import { presetToTiers, defaultPresetForLevel } from "../invariants/filter.js";
import type { ProjectConfig, GovernanceLevel } from "../wizard/types.js";
import { defaultContractType } from "../wizard/archetype-defaults.js";
import type { WriteResult } from "../utils/fs.js";

export interface ObsidianOptions {
  sync: boolean;
  dryRun: boolean;
  force: boolean;
  githubOnly: boolean;
  dir: string | undefined;
}

interface Counters {
  created: number;
  replaced: number;
  skipped: number;
}

function tallyResults(files: WriteResult[]): Counters {
  const counters: Counters = { created: 0, replaced: 0, skipped: 0 };
  for (const f of files) {
    if (f.action === "created") counters.created++;
    else if (f.action === "backed-up-and-replaced") counters.replaced++;
    else counters.skipped++;
  }
  return counters;
}

function resolveAxisFields(
  stored: ArbiterConfig | null,
  targetDir: string,
  language: ReturnType<typeof detectLanguage>,
  framework: string | null,
): {
  archetype: ProjectConfig["archetype"];
  architectureStyle: ProjectConfig["architectureStyle"];
  isMultiTenant: boolean;
  hasDatabase: boolean;
  hasPublicApi: boolean;
  contractType: NonNullable<ProjectConfig["contractType"]>;
} {
  const archetype =
    stored?.archetype ??
    detectArchetypeHint(targetDir, language, framework) ??
    "library";
  const hasPublicApi = stored?.hasPublicApi ?? archetype === "backend-web-db";
  return {
    archetype,
    architectureStyle: stored?.architectureStyle ?? "none",
    isMultiTenant: stored?.isMultiTenant ?? false,
    hasDatabase:
      stored?.hasDatabase ??
      (archetype === "backend-web-db" || archetype === "data-pipeline"),
    hasPublicApi,
    contractType:
      stored?.contractType ?? defaultContractType(archetype, hasPublicApi),
  };
}

function buildProjectConfig(
  targetDir: string,
  projectName: string,
  stored: ArbiterConfig | null,
): ProjectConfig {
  const language = detectLanguage(targetDir);
  const framework = detectFramework(targetDir, language);
  const buildCmds = detectBuildCommands(targetDir, language);
  const gitInfo = detectGitInfo(targetDir);
  const existing = detectExisting(targetDir);
  const governanceLevel: GovernanceLevel = stored?.governanceLevel ?? "L2";
  const axis = resolveAxisFields(stored, targetDir, language, framework);

  return {
    targetDir,
    projectName,
    description: `${projectName} project`,
    language,
    framework,
    ...axis,
    buildTool: buildCmds.buildTool,
    buildCommand: buildCmds.buildCommand,
    testCommand: buildCmds.testCommand,
    lintCommand: buildCmds.lintCommand,
    formatCommand: buildCmds.formatCommand,
    tools: stored?.tools ?? ["claude"],
    governanceLevel,
    useGitHub: stored?.useGitHub ?? false,
    githubOwner: gitInfo.githubOwner,
    githubRepo: gitInfo.githubRepo,
    existing,
    languageHooks: getLanguageHooks(language),
    enableDebtGates: stored?.enableDebtGates ?? governanceLevel !== "L1",
    enableSuppressions: stored?.enableSuppressions !== false,
    invariantTiers:
      stored?.invariantTiers ??
      presetToTiers(defaultPresetForLevel(governanceLevel)),
    enableObsidianVault: true,
  };
}

export async function runObsidian(options: ObsidianOptions): Promise<void> {
  await Promise.resolve();
  const targetDir = resolve(options.dir ?? process.cwd());
  const projectName = basename(targetDir);

  const stored = loadConfig(targetDir);
  if (!options.force && stored?.enableObsidianVault !== true) {
    throw new Error(
      "enableObsidianVault is not set in arbiter.json. Run `arbiter init --obsidian` or use --force.",
    );
  }

  const config = buildProjectConfig(targetDir, projectName, stored);

  console.log(`\n  Arbiter Obsidian Vault — ${projectName}\n`);

  const vaultOpts = { syncMode: options.sync, force: options.force };

  if (options.dryRun) {
    console.log("  Dry run — no files will be written.\n");
    console.log(
      "  Would generate vault at docs/vault/ (full file list skipped for POC).",
    );
    return;
  }

  const result = options.githubOnly
    ? generateGithubVaultNotes(config, vaultOpts)
    : generateObsidianVault(config, vaultOpts);

  const { created, replaced, skipped } = tallyResults(result.files);
  console.log(
    `  ${created} created, ${replaced} updated, ${skipped} preserved.`,
  );
}
