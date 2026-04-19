import { resolve, basename } from "node:path";
import { detectLanguage } from "../detectors/language.js";
import { detectBuildCommands } from "../detectors/build.js";
import { detectFramework } from "../detectors/framework.js";
import { detectGitInfo } from "../detectors/git.js";
import { detectExisting } from "../detectors/existing.js";
import { detectGithubAccess } from "../detectors/github.js";
import { getLanguageHooks } from "../detectors/language-hooks.js";
import { resolveAxisFields } from "../detectors/axis.js";
import { loadConfig, saveConfig } from "../utils/config.js";
import {
  runGenerators,
  runPlugins,
  runGithubSetup,
  printResults,
} from "./init.js";
import { presetToTiers, defaultPresetForLevel } from "../invariants/filter.js";

export interface UpdateOptions {
  dir: string | undefined;
  github: boolean;
}

export async function runUpdate(options: UpdateOptions): Promise<void> {
  const targetDir = resolve(options.dir ?? process.cwd());
  const projectName = basename(targetDir);

  console.log("\n  Arbiter — update\n");

  const stored = loadConfig(targetDir);
  if (!stored) {
    console.log("  No arbiter.json found. Run `arbiter init` first.\n");
    process.exit(1);
  }

  console.log("  Detecting project...");
  const language = detectLanguage(targetDir);
  const framework = detectFramework(targetDir, language);
  const buildCmds = detectBuildCommands(targetDir, language);
  const gitInfo = detectGitInfo(targetDir);
  const existing = detectExisting(targetDir);
  const githubAccess = detectGithubAccess();

  console.log(
    `  ├── Language: ${language}${framework ? ` / ${framework}` : ""}`,
  );
  console.log(
    `  ├── Config: tools=[${stored.tools.join(",")}] level=${stored.governanceLevel}`,
  );

  const useGitHub = options.github
    ? githubAccess.authenticated
    : stored.useGitHub && githubAccess.authenticated;

  const {
    archetype,
    architectureStyle,
    isMultiTenant,
    hasDatabase,
    hasPublicApi,
    contractType,
  } = resolveAxisFields(stored, targetDir, language, framework);

  const config = {
    targetDir,
    projectName,
    description: `${projectName} project`,
    language,
    framework,
    archetype,
    architectureStyle,
    isMultiTenant,
    hasDatabase,
    hasPublicApi,
    buildTool: buildCmds.buildTool,
    buildCommand: buildCmds.buildCommand,
    testCommand: buildCmds.testCommand,
    lintCommand: buildCmds.lintCommand,
    formatCommand: buildCmds.formatCommand,
    tools: stored.tools,
    governanceLevel: stored.governanceLevel,
    useGitHub,
    githubOwner: gitInfo.githubOwner,
    githubRepo: gitInfo.githubRepo,
    existing,
    languageHooks: getLanguageHooks(language),
    enableDebtGates: stored.enableDebtGates ?? stored.governanceLevel !== "L1",
    enableSuppressions: stored.enableSuppressions !== false,
    enableSecurityScanning:
      stored.enableSecurityScanning ?? stored.governanceLevel !== "L1",
    invariantTiers:
      stored.invariantTiers ??
      presetToTiers(defaultPresetForLevel(stored.governanceLevel)),
    contractType,
  };

  console.log("\n  Updating...");
  const results = runGenerators(config);
  const pluginResults = await runPlugins(
    targetDir,
    Array.isArray(stored.plugins) ? stored.plugins : [],
    stored,
  );
  results.push(...pluginResults);
  printResults(results, targetDir);

  const created = results.filter((r) => r.action === "created").length;
  const replaced = results.filter(
    (r) => r.action === "backed-up-and-replaced",
  ).length;
  const skipped = results.filter((r) => r.action === "skipped").length;
  console.log(
    `\n  Done! ${created} created, ${replaced} updated, ${skipped} skipped.`,
  );

  runGithubSetup(config);

  saveConfig(targetDir, {
    ...stored,
    useGitHub,
    archetype,
    architectureStyle,
    isMultiTenant,
    hasDatabase,
    hasPublicApi,
    contractType,
  });
  console.log(`\n  Run: node scripts/check-all.mjs L1  to verify\n`);
}
