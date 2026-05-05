import { resolve, basename } from "node:path";
import type { WriteResult } from "../utils/fs.js";
import { detectLanguage } from "../detectors/language.js";
import { detectBuildCommands } from "../detectors/build.js";
import { detectFramework } from "../detectors/framework.js";
import { detectGitInfo } from "../detectors/git.js";
import { detectExisting } from "../detectors/existing.js";
import { detectGithubAccess } from "../detectors/github.js";
import { getLanguageHooks } from "../detectors/language-hooks.js";
import { resolveAxisFields } from "../detectors/axis.js";
import {
  loadConfig,
  loadSnapshot,
  saveConfig,
  saveSnapshot,
} from "../utils/config.js";
import { runGithubSetup, printResults, runPlugins } from "./init.js";
import { presetToTiers, defaultPresetForLevel } from "../invariants/filter.js";
import { diffConfig, impactedGenerators } from "../config/diff.js";
import { validateConfig } from "../config/schema.js";
import {
  buildRegistry,
  runGeneratorsFromRegistry,
  runGeneratorsSelective,
} from "../generators/registry.js";
import type { GeneratorKey } from "../config/diff.js";
import type { ProjectConfig, Lane } from "../wizard/types.js";
import type { ArbiterConfigV2 } from "../utils/config.js";

export interface UpdateOptions {
  dir: string | undefined;
  github: boolean;
}

export interface UpdateResult {
  keysRun: Set<GeneratorKey | "*"> | null;
}

function v2ToProjectConfig(
  stored: ArbiterConfigV2,
  detectorFields: {
    targetDir: string;
    projectName: string;
    language: ReturnType<typeof detectLanguage>;
    framework: string | null;
    buildTool: string;
    buildCommand: string;
    testCommand: string;
    lintCommand: string;
    formatCommand: string;
    useGitHub: boolean;
    githubOwner: string | null;
    githubRepo: string | null;
    existing: ProjectConfig["existing"];
    languageHooks: ProjectConfig["languageHooks"];
    archetype: ProjectConfig["archetype"];
    architectureStyle: ProjectConfig["architectureStyle"];
    isMultiTenant: boolean;
    hasDatabase: boolean;
    hasPublicApi: boolean;
    contractType: ProjectConfig["contractType"];
    lanes: Lane[];
  },
): ProjectConfig {
  const level = stored.governanceLevel;
  return {
    ...detectorFields,
    projectName: detectorFields.projectName,
    description: `${detectorFields.projectName} project`,
    tools: stored.tools,
    governanceLevel: level,
    enableDebtGates: stored.features.debtGates,
    enableSuppressions: stored.features.suppressions,
    enableSecurityScanning: stored.features.securityScanning,
    enableMutationTesting: stored.features.mutationTesting,
    enableContractTesting: stored.features.contractTesting,
    enableEvidenceHarness: stored.features.evidenceHarness,
    invariantTiers:
      stored.invariantTiers ?? presetToTiers(defaultPresetForLevel(level)),
    acceptBetaTools: stored.acceptBetaTools ?? false,
    ...(stored.evidenceRetention !== undefined && {
      evidenceRetention: stored.evidenceRetention,
    }),
    ...(stored.thresholdProfile !== undefined && {
      thresholdProfile: stored.thresholdProfile,
    }),
    ...(stored.strictnessTier !== undefined && {
      strictnessTier: stored.strictnessTier,
    }),
    enableObsidianVault: stored.enableObsidianVault ?? false,
    contractType: detectorFields.contractType,
    thresholds: stored.thresholds,
    lanes: detectorFields.lanes,
  };
}

function printStats(results: WriteResult[]): void {
  const created = results.filter((r) => r.action === "created").length;
  const replaced = results.filter(
    (r) => r.action === "backed-up-and-replaced",
  ).length;
  const skipped = results.filter((r) => r.action === "skipped").length;
  console.log(
    `\n  Done! ${created} created, ${replaced} updated, ${skipped} skipped.`,
  );
}

function selectAndRun(
  specs: ReturnType<typeof buildRegistry>,
  snapshot: ArbiterConfigV2 | null,
  stored: ArbiterConfigV2,
): { results: WriteResult[]; keysRun: Set<GeneratorKey | "*"> | null } {
  if (!snapshot) {
    return { results: runGeneratorsFromRegistry(specs), keysRun: null };
  }
  const diff = diffConfig(snapshot, stored);
  if (diff.paths.length === 0) {
    console.log(
      "  No config changes detected — re-running to pick up template updates.",
    );
    return { results: runGeneratorsFromRegistry(specs), keysRun: null };
  }
  const keys = impactedGenerators(diff);
  if (keys.has("*") || keys.size === 0) {
    const reason =
      keys.size === 0 ? "Unknown config change" : "Governance/axis change";
    console.log(`  ${reason} detected — full regeneration.`);
    return { results: runGeneratorsFromRegistry(specs), keysRun: keys };
  }
  console.log(`  Selective update: ${keys.size} generator group(s).`);
  return { results: runGeneratorsSelective(specs, keys), keysRun: keys };
}

export async function runUpdate(options: UpdateOptions): Promise<UpdateResult> {
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
    lanes,
  } = resolveAxisFields(stored, targetDir, language, framework);

  const detectorFields = {
    targetDir,
    projectName,
    language,
    framework,
    buildTool: buildCmds.buildTool,
    buildCommand: buildCmds.buildCommand,
    testCommand: buildCmds.testCommand,
    lintCommand: buildCmds.lintCommand,
    formatCommand: buildCmds.formatCommand,
    useGitHub,
    githubOwner: gitInfo.githubOwner,
    githubRepo: gitInfo.githubRepo,
    existing,
    languageHooks: getLanguageHooks(language),
    archetype,
    architectureStyle,
    isMultiTenant,
    hasDatabase,
    hasPublicApi,
    contractType,
    lanes,
  };

  const config = v2ToProjectConfig(stored, detectorFields);
  const specs = buildRegistry(config);
  const snapshot = loadSnapshot(targetDir);

  console.log("\n  Updating...");

  const { results, keysRun } = selectAndRun(specs, snapshot, stored);
  const pluginResults = await runPlugins(
    targetDir,
    Array.isArray(stored.plugins) ? stored.plugins : [],
    stored,
  );
  results.push(...pluginResults);

  printResults(results, targetDir);
  printStats(results);

  runGithubSetup(config);

  const nextConfig: ArbiterConfigV2 = {
    ...stored,
    useGitHub,
    archetype,
    architectureStyle,
    isMultiTenant,
    hasDatabase,
    hasPublicApi,
    contractType,
    ...(lanes.length > 0 && { lanes }),
  };

  const validation = validateConfig(nextConfig);
  if (!validation.ok) {
    console.error(
      `  [arbiter] Config invalid after update: ${validation.errors.join("; ")}`,
    );
    process.exit(1);
  }

  saveConfig(targetDir, validation.config);
  saveSnapshot(targetDir, validation.config);
  console.log(`\n  Run: node scripts/check-all.mjs L1  to verify\n`);

  return { keysRun };
}
