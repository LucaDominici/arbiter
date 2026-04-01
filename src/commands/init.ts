import { resolve, basename } from "node:path";
import { detectLanguage } from "../detectors/language.js";
import { detectBuildCommands } from "../detectors/build.js";
import { detectFramework } from "../detectors/framework.js";
import { detectGitInfo } from "../detectors/git.js";
import { detectExisting } from "../detectors/existing.js";
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
import { provisionLabels } from "../github/labels.js";
import { applyBranchProtection } from "../github/branch-protection.js";
import { saveConfig } from "../utils/config.js";
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

  console.log("\n  Generating...");
  const allResults = runGenerators(config);

  printResults(allResults, targetDir);

  const created = allResults.filter((r) => r.action === "created").length;
  const skipped = allResults.filter((r) => r.action === "skipped").length;
  console.log(`\n  Done! ${created} files created, ${skipped} skipped.`);

  runGithubSetup(config);

  // Save config for future `arbiter update`
  saveConfig(targetDir, {
    version: "0.1",
    tools: config.tools,
    governanceLevel: config.governanceLevel,
    useGitHub: config.useGitHub,
  });

  console.log(`\n  Run: node scripts/check-all.mjs L1  to verify\n`);
}

export function runGenerators(config: ProjectConfig): WriteResult[] {
  const all: WriteResult[] = [];

  // AGENTS.md is always generated — it's the canonical governance source
  all.push(generateAgentsMd(config));

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
  }

  if (config.useGitHub) {
    all.push(...generateGithub(config).files);
    all.push(...generateRoot(config).files);
    all.push(...generateCheckAll(config).files);
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
}): ProjectConfig {
  return {
    targetDir: opts.targetDir,
    projectName: opts.projectName,
    description: `${opts.projectName} project`,
    language: opts.language,
    framework: opts.framework,
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
  };
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
