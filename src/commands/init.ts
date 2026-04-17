import { resolve, basename } from "node:path";
import { runProbes } from "../compatibility/probe.js";
import { formatText } from "../compatibility/report.js";
import { detectLanguage } from "../detectors/language.js";
import { detectBuildCommands } from "../detectors/build.js";
import {
  detectFramework,
  detectArchetypeHint,
} from "../detectors/framework.js";
import { detectGitInfo } from "../detectors/git.js";
import { detectExisting } from "../detectors/existing.js";
import { detectBasePackage } from "../detectors/package.js";
import { detectGithubAccess } from "../detectors/github.js";
import { getLanguageHooks } from "../detectors/language-hooks.js";
import {
  runWizard,
  determineFlow,
  buildMigrationPlan,
  displayMigrationPlan,
} from "../wizard/prompts.js";
import { generateAgentsMd } from "../generators/agents-md.js";
import { generateClaude } from "../generators/claude.js";
import { generateCodex } from "../generators/codex.js";
import { generateGithub } from "../generators/github.js";
import { generateRoot } from "../generators/root.js";
import { generateCheckAll } from "../generators/check-all.js";
import { generateCursor } from "../generators/cursor.js";
import { generateCopilot } from "../generators/copilot.js";
import { generateDebtGates } from "../generators/debt-gates.js";
import { generateDebtRatchet } from "../generators/debt-ratchet.js";
import { generateSuppressions } from "../generators/suppressions.js";
import { generateSecurity } from "../generators/security.js";
import { generateStrideEnforcement } from "../generators/stride-enforcement.js";
import { generateEvidenceRetention } from "../generators/evidence-retention.js";
import { generateTestTaxonomy } from "../generators/test-taxonomy.js";
import { generateArchUnit } from "../generators/archunit.js";
import { generateEslintBoundaries } from "../generators/boundaries.js";
import { generateRustBoundaries } from "../generators/rust-boundaries.js";
import { generateGoBoundaries } from "../generators/go-boundaries.js";
import { generatePythonBoundaries } from "../generators/python-boundaries.js";
import { generateMutation } from "../generators/mutation.js";
import { generateNightly } from "../generators/nightly.js";
import { generateGlobalInvariants } from "../generators/global-invariants.js";
import { generateSkills } from "../generators/skills.js";
import { generateAgentsClaude } from "../generators/agents-claude.js";
import { generateSsot } from "../generators/ssot.js";
import { generateObsidianVault } from "../generators/obsidian-vault.js";
import { provisionLabels } from "../github/labels.js";
import { applyBranchProtection } from "../github/branch-protection.js";
import { createProjectBoard } from "../github/project-board.js";
import { saveConfig } from "../utils/config.js";
import type { ArbiterConfig } from "../utils/config.js";
import { isL3Allowed } from "../utils/maturity-check.js";
import { runCli } from "../utils/run-cli.js";
import { presetToTiers, defaultPresetForLevel } from "../invariants/filter.js";
import { defaultContractType } from "../wizard/archetype-defaults.js";
import type {
  ProjectConfig,
  AiTool,
  GovernanceLevel,
} from "../wizard/types.js";
import type { WriteResult } from "../utils/fs.js";

export interface InitOptions {
  yes: boolean;
  tools: string | undefined;
  level: string | undefined;
  dir: string | undefined;
  dryRun: boolean;
  obsidian: boolean;
  /** Auto-capture debt baseline after generation (brownfield day-0 lock-in). */
  brownfield: boolean;
  /** Skip toolchain compatibility probes after generation. */
  noVerify: boolean;
  /** Allow L3 generation with beta-maturity tools. Persisted in arbiter.json for audit. */
  acceptBetaTools?: boolean;
}

export async function runInit(options: InitOptions): Promise<void> {
  const targetDir = resolve(options.dir ?? process.cwd());
  const projectName = basename(targetDir);

  console.log("\n  Arbiter — AI Development Governance Framework\n");
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
  console.log(`  ├── Build: ${buildCmds.buildTool}`);
  console.log(
    `  ├── Git: ${gitInfo.isGitRepo ? "yes" : "no"}${gitInfo.githubRepo ? ` (${gitInfo.githubOwner}/${gitInfo.githubRepo})` : ""}`,
  );
  if (githubAccess.authenticated)
    console.log(
      `  ├── GitHub: authenticated as ${githubAccess.username ?? "unknown"}`,
    );
  logExistingDetections(existing);

  let config: ProjectConfig;
  if (options.yes) {
    config = buildDefaultConfig({
      targetDir,
      projectName,
      language,
      framework,
      buildCmds,
      gitInfo,
      existing,
      tools: parseTools(options.tools),
      governanceLevel: parseLevel(options.level),
      useGitHub: githubAccess.authenticated,
      obsidian: options.obsidian,
      acceptBetaTools: options.acceptBetaTools ?? false,
    });
  } else {
    const wizardResult = await runWizard({
      targetDir,
      projectName,
      language,
      framework,
      buildCmds,
      gitInfo,
      existing,
      githubAccess,
    });
    if (wizardResult === null) {
      console.log("\n  Cancelled.\n");
      return;
    }
    config = wizardResult;
  }

  if (options.dryRun) {
    displayDryRunPreview(config);
    return;
  }

  checkL3MaturityGates(config);

  console.log("\n  Generating...");
  const allResults = runGenerators(config);

  printResults(allResults, targetDir);

  const created = allResults.filter((r) => r.action === "created").length;
  const skipped = allResults.filter((r) => r.action === "skipped").length;
  console.log(`\n  Done! ${created} files created, ${skipped} skipped.`);

  runGithubSetup(config);

  // Save config for future `arbiter update`
  saveConfig(targetDir, buildArbiterConfig(config));

  if (options.brownfield && config.enableDebtGates) {
    runBrownfieldCapture(targetDir);
  }

  if (!options.noVerify) {
    runToolchainVerify(targetDir);
  }

  console.log(`\n  Run: node scripts/check-all.mjs L1  to verify\n`);
}

export function runGenerators(config: ProjectConfig): WriteResult[] {
  const all: WriteResult[] = [];

  // AGENTS.md is always generated — it's the canonical governance source
  all.push(generateAgentsMd(config));

  // GLOBAL_INVARIANTS.md generated for standard/full presets (optional tiers selected)
  all.push(generateGlobalInvariants(config));

  // Skip tool-specific configs when ai-rulez manages them
  if (!config.existing.aiRulez) {
    if (config.tools.includes("claude"))
      all.push(...generateClaude(config).files);
    if (config.tools.includes("codex"))
      all.push(...generateCodex(config).files);
    if (config.tools.includes("cursor"))
      all.push(...generateCursor(config).files);
    if (config.tools.includes("copilot"))
      all.push(...generateCopilot(config).files);
    all.push(...generateSkills(config).files);
    all.push(...generateAgentsClaude(config).files);
  }

  if (config.useGitHub) {
    all.push(...generateGithub(config).files);
    all.push(...generateRoot(config).files);
    all.push(...generateCheckAll(config).files);
  }

  if (config.enableDebtGates) {
    all.push(...generateDebtGates(config).files);
    all.push(...generateDebtRatchet(config).files);
  }

  if (config.enableSuppressions) {
    all.push(...generateSuppressions(config).files);
  }

  if (config.enableSecurityScanning) {
    all.push(...generateSecurity(config).files);
  }

  all.push(...generateArchUnit(config).files);
  all.push(...generateEslintBoundaries(config).files);
  all.push(...generateRustBoundaries(config).files);
  all.push(...generateGoBoundaries(config).files);
  all.push(...generatePythonBoundaries(config).files);
  all.push(...generateMutation(config).files);
  all.push(...generateNightly(config).files);

  if (config.enableDebtGates) {
    all.push(...generateStrideEnforcement(config).files);
  }

  all.push(...generateEvidenceRetention(config).files);

  all.push(...generateTestTaxonomy(config).files);

  all.push(...generateSsot(config).files);

  if (config.enableObsidianVault) {
    all.push(...generateObsidianVault(config).files);
  }

  return all;
}

export function runGithubSetup(config: ProjectConfig): void {
  if (!config.useGitHub || !config.githubOwner || !config.githubRepo) return;

  console.log("\n  GitHub setup...");
  console.log("  ├── Provisioning labels...");
  const labelResult = provisionLabels(config.githubOwner, config.githubRepo);
  if (labelResult.created.length > 0)
    console.log(`  │   Created: ${labelResult.created.join(", ")}`);
  if (labelResult.updated.length > 0)
    console.log(`  │   Updated: ${labelResult.updated.join(", ")}`);
  if (labelResult.errors.length > 0)
    console.log(`  │   Errors: ${labelResult.errors.join(", ")}`);

  console.log("  ├── Applying branch protection to main...");
  const bp = applyBranchProtection(config.githubOwner, config.githubRepo);
  if (bp.applied) {
    console.log("  │   Branch protection applied.");
  } else {
    console.log(
      `  │   Skipped (requires admin access): ${bp.error ?? "unknown error"}`,
    );
  }

  console.log("  └── Creating project board...");
  const pb = createProjectBoard(config.githubOwner, config.githubRepo);
  if (pb.created) {
    console.log(`      Project board created: ${pb.projectUrl}`);
  } else {
    console.log(`      Skipped: ${pb.error ?? "unknown error"}`);
  }
}

function logExistingDetections(
  existing: ReturnType<typeof detectExisting>,
): void {
  if (existing.agentsMd)
    console.log("  ├── Existing AGENTS.md detected — will back up");
  if (existing.claudeDir)
    console.log("  ├── Existing .claude/ detected — will merge");
  if (existing.agentsDir)
    console.log("  ├── Existing .agents/ detected — will merge");
  if (existing.aiRulez)
    console.log(
      "  ├── ai-rulez detected — skipping tool configs (AGENTS.md + GitHub only)",
    );
}

function runBrownfieldCapture(targetDir: string): void {
  console.log("\n  Capturing debt baseline (this may take a few minutes)…");
  try {
    runCli("node", ["scripts/capture-debt-baseline.mjs"], {
      cwd: targetDir,
      timeoutMs: 600_000,
    });
    console.log("  Baseline captured at scripts/debt-baseline.json");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `  Baseline capture failed (${msg}). Re-run manually: node scripts/capture-debt-baseline.mjs`,
    );
    // Non-fatal: generated files are on disk; toolchain may be incomplete
  }
}

export function printResults(results: WriteResult[], targetDir: string): void {
  for (const result of results) {
    const icon = result.action === "skipped" ? "│  " : "├──";
    const label =
      result.action === "skipped"
        ? " (skipped — already exists)"
        : result.action === "backed-up-and-replaced"
          ? " (backed up + replaced)"
          : "";
    const relPath = result.path.replace(targetDir + "/", "");
    console.log(`  ${icon} ${relPath}${label}`);
  }
}

function displayDryRunPreview(config: ProjectConfig): void {
  const flow = determineFlow(config.existing);
  const plan = buildMigrationPlan(
    config.existing,
    config.tools,
    config.useGitHub,
  );
  console.log("\n  Dry run — no files will be written.\n");
  if (flow === "brownfield") {
    displayMigrationPlan(plan);
  } else {
    console.log(
      `  Would generate governance files for: ${config.tools.join(", ")}`,
    );
    for (const entry of plan.created) {
      console.log(`  ├── ${entry}`);
    }
  }
  console.log("\n  Run without --dry-run to apply.\n");
}

function buildDefaultConfig(opts: {
  targetDir: string;
  projectName: string;
  language: ReturnType<typeof detectLanguage>;
  framework: string | null;
  buildCmds: ReturnType<typeof detectBuildCommands>;
  gitInfo: ReturnType<typeof detectGitInfo>;
  existing: ReturnType<typeof detectExisting>;
  tools: AiTool[];
  governanceLevel: GovernanceLevel;
  useGitHub: boolean;
  obsidian?: boolean;
  acceptBetaTools?: boolean;
}): ProjectConfig {
  const archetype =
    detectArchetypeHint(opts.targetDir, opts.language, opts.framework) ??
    "library";
  const hasDatabase =
    archetype === "backend-web-db" || archetype === "data-pipeline";
  const hasPublicApi = archetype === "backend-web-db";
  return {
    targetDir: opts.targetDir,
    projectName: opts.projectName,
    description: `${opts.projectName} project`,
    language: opts.language,
    framework: opts.framework,
    archetype,
    architectureStyle: "none",
    isMultiTenant: false,
    hasDatabase,
    hasPublicApi,
    buildTool: opts.buildCmds.buildTool,
    buildCommand: opts.buildCmds.buildCommand,
    testCommand: opts.buildCmds.testCommand,
    lintCommand: opts.buildCmds.lintCommand,
    formatCommand: opts.buildCmds.formatCommand,
    tools: opts.tools,
    governanceLevel: opts.governanceLevel,
    useGitHub: opts.useGitHub,
    githubOwner: opts.gitInfo.githubOwner,
    githubRepo: opts.gitInfo.githubRepo,
    existing: opts.existing,
    languageHooks: getLanguageHooks(opts.language),
    enableDebtGates: opts.governanceLevel !== "L1",
    enableSuppressions: true,
    enableSecurityScanning: opts.governanceLevel !== "L1",
    invariantTiers: presetToTiers(defaultPresetForLevel(opts.governanceLevel)),
    enableObsidianVault: opts.obsidian ?? false,
    acceptBetaTools: opts.acceptBetaTools ?? false,
    contractType: defaultContractType(archetype, hasPublicApi),
    ...detectedBasePackage(opts.language, opts.targetDir),
  };
}

function buildArbiterConfig(config: ProjectConfig): ArbiterConfig {
  return {
    version: "0.1",
    tools: config.tools,
    governanceLevel: config.governanceLevel,
    useGitHub: config.useGitHub,
    enableDebtGates: config.enableDebtGates,
    enableSuppressions: config.enableSuppressions,
    enableSecurityScanning: config.enableSecurityScanning,
    invariantTiers: config.invariantTiers,
    archetype: config.archetype,
    architectureStyle: config.architectureStyle,
    isMultiTenant: config.isMultiTenant,
    hasDatabase: config.hasDatabase,
    hasPublicApi: config.hasPublicApi,
    ...(config.enableObsidianVault === true
      ? { enableObsidianVault: true }
      : {}),
    ...(config.acceptBetaTools === true ? { acceptBetaTools: true } : {}),
    ...(config.evidenceRetention !== undefined
      ? { evidenceRetention: config.evidenceRetention }
      : {}),
    ...(config.thresholdProfile !== undefined
      ? { thresholdProfile: config.thresholdProfile }
      : {}),
    ...(config.strictnessTier !== undefined
      ? { strictnessTier: config.strictnessTier }
      : {}),
    contractType: config.contractType,
  };
}

function detectedBasePackage(
  language: ReturnType<typeof detectLanguage>,
  targetDir: string,
): { basePackage: string } | Record<never, never> {
  if (language !== "java") return {};
  const bp = detectBasePackage(targetDir);
  return bp !== undefined ? { basePackage: bp } : {};
}

function parseTools(tools: string | undefined): AiTool[] {
  if (!tools) return ["claude", "codex"];
  return tools
    .split(",")
    .filter((t): t is AiTool =>
      ["claude", "codex", "cursor", "copilot"].includes(t),
    );
}

function parseLevel(level: string | undefined): GovernanceLevel {
  if (level === "L1" || level === "L2" || level === "L3") return level;
  return "L2";
}

/**
 * Gate check for L3 maturity. Blocks generation if any L3 feature
 * (mutation, contract) is marked unsafe or beta without --accept-beta-tools.
 * Exits the process with an actionable error message on violation.
 */
function checkL3MaturityGates(config: ProjectConfig): void {
  if (config.governanceLevel !== "L3") return;

  const l3Features: Array<"mutation" | "contract"> = ["mutation", "contract"];
  const blocked: string[] = [];

  for (const feature of l3Features) {
    const result = isL3Allowed(
      config.language,
      feature,
      config.acceptBetaTools ?? false,
    );
    if (!result.allowed && result.errorMessage) {
      blocked.push(`  • ${result.errorMessage}`);
    }
  }

  if (blocked.length > 0) {
    console.error("\n  arbiter init aborted: L3 maturity gate failed.\n");
    for (const msg of blocked) {
      console.error(msg);
    }
    console.error(
      "\n  Use --accept-beta-tools to allow beta tools, or reduce governance to L2.\n",
    );
    process.exit(1);
  }
}

function runToolchainVerify(targetDir: string): void {
  console.log("\n  Verifying toolchain compatibility...");
  let report: ReturnType<typeof runProbes>;
  try {
    report = runProbes(targetDir);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `\n  Toolchain verification failed unexpectedly: ${msg}\n` +
        "  Generated files are on disk. Use --no-verify to skip verification.\n",
    );
    process.exit(1);
  }
  console.log(formatText(report));
  if (report.hasFailures) {
    console.error(
      "\n  arbiter init aborted: toolchain incompatibilities detected.\n" +
        "  Fix the issues above and re-run, or use --no-verify to skip.\n",
    );
    process.exit(1);
  }
}
