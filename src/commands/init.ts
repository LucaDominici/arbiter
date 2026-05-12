import { mkdirSync } from "node:fs";
import { resolve, basename, join } from "node:path";
import { jsonOutput } from "../utils/json-output.js";
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
import { detectLanes } from "../detectors/lanes.js";
import {
  runWizard,
  determineFlow,
  buildMigrationPlan,
  displayMigrationPlan,
} from "../wizard/prompts.js";
import { provisionLabels } from "../github/labels.js";
import { applyBranchProtection } from "../github/branch-protection.js";
import { createProjectBoard } from "../github/project-board.js";
import { saveConfig } from "../utils/config.js";
import type { ArbiterConfig } from "../utils/config.js";
import { DEFAULT_THRESHOLDS } from "../config/schema.js";
import {
  buildRegistry,
  runGeneratorsFromRegistry,
} from "../generators/registry.js";
import { loadPlugin } from "../utils/plugin-loader.js";
import { renderFromAbsPath } from "../utils/render.js";
import { writeFile } from "../utils/fs.js";
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
  /** Auto-capture debt baseline after generation (brownfield day-0 lock-in). */
  brownfield: boolean;
  /** Skip toolchain compatibility probes after generation. */
  noVerify: boolean;
  /** Allow L3 generation with beta-maturity tools. Persisted in arbiter.json for audit. */
  acceptBetaTools?: boolean;
  /** Override decomposition backend (github|markdown). If absent, derived from gh auth status. */
  backend?: "github" | "markdown";
  /** Emit machine-readable JSON envelope instead of human output. Requires --yes (wizard is incompatible). */
  json?: boolean | undefined;
}

export async function runInit(options: InitOptions): Promise<void> {
  const targetDir = resolve(options.dir ?? process.cwd());
  const projectName = basename(targetDir);
  const log: (msg: string) => void = options.json
    ? (): void => {}
    : (msg: string): void => {
        console.log(msg);
      };

  // --json requires --yes: interactive wizard reads stdin which is incompatible with
  // machine-readable output. Fail fast with a clear JSON error.
  if (options.json && !options.yes) {
    jsonOutput("init", "error", {}, [
      "--json requires --yes (interactive wizard is incompatible with machine-readable output)",
    ]);
    process.exit(1);
    return;
  }

  log("\n  Arbiter — AI Development Governance Framework\n");
  log("  Detecting project...");

  const language = detectLanguage(targetDir);
  const framework = detectFramework(targetDir, language);
  const buildCmds = detectBuildCommands(targetDir, language);
  const gitInfo = detectGitInfo(targetDir);
  const existing = detectExisting(targetDir);
  const githubAccess = detectGithubAccess();
  const lanesResult = detectLanes(targetDir);

  log(`  ├── Language: ${language}${framework ? ` / ${framework}` : ""}`);
  log(`  ├── Build: ${buildCmds.buildTool}`);
  log(
    `  ├── Git: ${gitInfo.isGitRepo ? "yes" : "no"}${gitInfo.githubRepo ? ` (${gitInfo.githubOwner}/${gitInfo.githubRepo})` : ""}`,
  );
  if (githubAccess.authenticated)
    log(`  ├── GitHub: authenticated as ${githubAccess.username ?? "unknown"}`);
  if (!options.json) logExistingDetections(existing);

  const config = await resolveConfig({
    options,
    targetDir,
    projectName,
    language,
    framework,
    buildCmds,
    gitInfo,
    existing,
    githubAccess,
    lanes: lanesResult.lanes,
    log,
  });
  if (config === null) return;

  if (options.dryRun) {
    displayDryRunPreview(config);
    return;
  }

  checkL3MaturityGates(config);
  generateAndFinalize(config, targetDir, options, log);
}

function generateAndFinalize(
  config: ProjectConfig,
  targetDir: string,
  options: InitOptions,
  log: (msg: string) => void,
): void {
  log("\n  Generating...");
  const allResults = runGenerators(config);
  if (!options.json) printResults(allResults, targetDir);

  const created = allResults.filter((r) => r.action === "created").length;
  const skipped = allResults.filter((r) => r.action === "skipped").length;
  log(`\n  Done! ${created} files created, ${skipped} skipped.`);

  runBackendSetup(config);
  saveConfig(targetDir, buildArbiterConfig(config));
  maybeCaptureBaseline(config, targetDir, options.brownfield);

  if (!options.noVerify) {
    runToolchainVerify(targetDir);
  }

  if (options.json) {
    jsonOutput("init", "ok", { created, skipped });
    return;
  }
  console.log(`\n  Run: node scripts/check-all.mjs L1  to verify\n`);
}

async function resolveConfig(args: {
  options: InitOptions;
  targetDir: string;
  projectName: string;
  language: ReturnType<typeof detectLanguage>;
  framework: string | null;
  buildCmds: ReturnType<typeof detectBuildCommands>;
  gitInfo: ReturnType<typeof detectGitInfo>;
  existing: ReturnType<typeof detectExisting>;
  githubAccess: ReturnType<typeof detectGithubAccess>;
  lanes: import("../wizard/types.js").Lane[];
  log: (msg: string) => void;
}): Promise<ProjectConfig | null> {
  const {
    options,
    targetDir,
    projectName,
    language,
    framework,
    buildCmds,
    gitInfo,
    existing,
    githubAccess,
    lanes,
    log,
  } = args;
  if (options.yes) {
    const useGitHub =
      options.backend !== undefined
        ? options.backend === "github"
        : githubAccess.authenticated;
    return buildDefaultConfig({
      targetDir,
      projectName,
      language,
      framework,
      buildCmds,
      gitInfo,
      existing,
      tools: parseTools(options.tools),
      governanceLevel: parseLevel(options.level),
      useGitHub,
      acceptBetaTools: options.acceptBetaTools ?? false,
      lanes,
    });
  }
  const wizardResult = await runWizard({
    targetDir,
    projectName,
    language,
    framework,
    buildCmds,
    gitInfo,
    existing,
    githubAccess,
    detectedLanes: lanes,
  });
  if (wizardResult === null) {
    log("\n  Cancelled.\n");
    return null;
  }
  return wizardResult;
}

export function runGenerators(config: ProjectConfig): WriteResult[] {
  return runGeneratorsFromRegistry(buildRegistry(config));
}

export async function runPlugins(
  targetDir: string,
  plugins: string[],
  storedConfig: ArbiterConfig,
): Promise<WriteResult[]> {
  const all: WriteResult[] = [];
  const writtenPaths = new Set<string>();
  for (const pkg of plugins) {
    try {
      const plugin = await loadPlugin(pkg, targetDir);
      if (plugin.detect && !plugin.detect(storedConfig)) continue;
      const ctx = {
        config: storedConfig,
        targetDir,
        renderTemplate(relPath: string, data: Record<string, unknown>): string {
          return renderFromAbsPath(join(plugin.templateRoot, relPath), data);
        },
      };
      const result = plugin.generate(ctx);
      if (!Array.isArray(result.files)) {
        console.warn(
          `  [arbiter] Plugin "${pkg}" returned invalid result (no files array). Skipping.`,
        );
        continue;
      }
      for (const file of result.files) {
        if (writtenPaths.has(file.path)) {
          console.warn(
            `  [arbiter] Plugin "${pkg}" conflict: "${file.path}" already written by a prior plugin. Skipping.`,
          );
          all.push({ path: file.path, action: "skipped" });
          continue;
        }
        writtenPaths.add(file.path);
        all.push(
          writeFile(file.path, file.content, {
            backup: file.action === "backup-and-replace",
            skipIfExists: file.action === "skip",
          }),
        );
      }
    } catch (err) {
      console.warn(
        `  [arbiter] Plugin "${pkg}" failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return all;
}

function runBackendSetup(config: ProjectConfig): void {
  const backend =
    config.decompositionBackend ?? (config.useGitHub ? "github" : "markdown");
  if (backend === "github") {
    runGithubSetup(config);
  } else {
    const workDir = join(config.targetDir, ".arbiter", "work");
    mkdirSync(workDir, { recursive: true });
    console.log("\n  Markdown backend: scaffolded .arbiter/work/");
  }
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
    for (const w of pb.warnings) console.log(`      Warning: ${w}`);
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
  if (existing.geminiDir)
    console.log("  ├── Existing .gemini/ detected — will back up");
  if (existing.windsurfRules)
    console.log(
      "  ├── Existing windsurf-instructions.md detected — will back up",
    );
  if (existing.aiderConf)
    console.log("  ├── Existing .aider.conf.yml detected — will back up");
  if (existing.aiRulez)
    console.log(
      "  ├── ai-rulez detected — skipping tool configs (AGENTS.md + GitHub only)",
    );
}

function maybeCaptureBaseline(
  config: ProjectConfig,
  targetDir: string,
  brownfield: boolean,
): void {
  if (config.governanceLevel === "L3" && config.enableDebtGates) {
    runBrownfieldCapture(targetDir, { fatal: true });
  } else if (brownfield && config.enableDebtGates) {
    runBrownfieldCapture(targetDir);
  }
}

function runBrownfieldCapture(
  targetDir: string,
  opts: { fatal: boolean } = { fatal: false },
): void {
  console.log("\n  Capturing debt baseline (this may take a few minutes)…");
  try {
    runCli("node", ["scripts/capture-debt-baseline.mjs"], {
      cwd: targetDir,
      timeoutMs: 600_000,
    });
    console.log("  Baseline captured at scripts/debt-baseline.json");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (opts.fatal) {
      console.error(
        `  [arbiter] GATE FAIL: Baseline capture failed (${msg}). Fix toolchain or run: node scripts/capture-debt-baseline.mjs`,
      );
      process.exit(1);
    }
    console.warn(
      `  Baseline capture failed (${msg}). Re-run manually: node scripts/capture-debt-baseline.mjs`,
    );
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
  acceptBetaTools?: boolean;
  lanes?: import("../wizard/types.js").Lane[];
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
    decompositionBackend: opts.useGitHub ? "github" : "markdown",
    githubOwner: opts.gitInfo.githubOwner,
    githubRepo: opts.gitInfo.githubRepo,
    existing: opts.existing,
    languageHooks: getLanguageHooks(opts.language),
    enableDebtGates: opts.governanceLevel !== "L1",
    enableSuppressions: true,
    enableSecurityScanning: opts.governanceLevel !== "L1",
    enableMutationTesting: opts.governanceLevel !== "L1",
    enableContractTesting:
      defaultContractType(archetype, hasPublicApi) !== "none",
    enableEvidenceHarness: opts.governanceLevel !== "L1",
    enableSelfValidationHarness: true,
    invariantTiers: presetToTiers(defaultPresetForLevel(opts.governanceLevel)),
    acceptBetaTools: opts.acceptBetaTools ?? false,
    contractType: defaultContractType(archetype, hasPublicApi),
    thresholds: DEFAULT_THRESHOLDS[opts.governanceLevel],
    lanes: opts.lanes ?? [],
    ...detectedBasePackage(opts.language, opts.targetDir),
  };
}

function buildArbiterConfig(config: ProjectConfig): ArbiterConfig {
  const level = config.governanceLevel;
  const backend =
    config.decompositionBackend ?? (config.useGitHub ? "github" : "markdown");
  return {
    version: "0.2",
    tools: config.tools,
    governanceLevel: level,
    useGitHub: config.useGitHub,
    decomposition: { backend },
    features: {
      debtGates: config.enableDebtGates,
      suppressions: config.enableSuppressions,
      securityScanning: config.enableSecurityScanning,
      mutationTesting: config.enableMutationTesting !== false,
      contractTesting: config.enableContractTesting !== false,
      evidenceHarness: config.enableEvidenceHarness === true,
      selfValidationHarness: config.enableSelfValidationHarness !== false,
    },
    thresholds: config.thresholds ?? DEFAULT_THRESHOLDS[level],
    invariantTiers: config.invariantTiers,
    archetype: config.archetype,
    architectureStyle: config.architectureStyle,
    isMultiTenant: config.isMultiTenant,
    hasDatabase: config.hasDatabase,
    hasPublicApi: config.hasPublicApi,
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
    ...(config.lanes.length > 0 ? { lanes: config.lanes } : {}),
    ...(config.taskTiers !== undefined ? { taskTiers: config.taskTiers } : {}),
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
      [
        "claude",
        "codex",
        "cursor",
        "copilot",
        "gemini",
        "windsurf",
        "aider",
      ].includes(t),
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
