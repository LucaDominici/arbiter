import inquirer from "inquirer";
import type {
  ProjectConfig,
  AiTool,
  WizardFlow,
  MigrationPlan,
  WizardAnswers,
  Language,
} from "./types.js";
import type { BuildCommands } from "../detectors/build.js";
import type { GitInfo } from "../detectors/git.js";
import type { ExistingState } from "../detectors/existing.js";
import type { GithubAccess } from "../detectors/github.js";
import { getLanguageHooks } from "../detectors/language-hooks.js";

export interface WizardInput {
  targetDir: string;
  projectName: string;
  language: Language;
  framework: string | null;
  buildCmds: BuildCommands;
  gitInfo: GitInfo;
  existing: ExistingState;
  githubAccess: GithubAccess;
}

export function determineFlow(existing: ExistingState): WizardFlow {
  if (existing.agentsMd || existing.claudeDir || existing.agentsDir) {
    return "brownfield";
  }
  return "greenfield";
}

export function buildMigrationPlan(
  existing: ExistingState,
  tools: AiTool[],
  useGitHub: boolean,
): MigrationPlan {
  const replaced: string[] = [];
  const preserved: string[] = [];
  const merged: string[] = [];
  const created: string[] = [];

  if (existing.agentsMd) {
    replaced.push("AGENTS.md");
  } else {
    created.push("AGENTS.md");
  }

  if (tools.includes("claude") && !existing.aiRulez) {
    if (existing.claudeDir) {
      replaced.push(".claude/CLAUDE.md");
      if (existing.settingsJson) {
        merged.push(".claude/settings.json (deep-merged)");
      } else {
        created.push(".claude/settings.json");
      }
      preserved.push(".claude/hooks/ (existing hooks preserved)");
      preserved.push(".claude/rules/ (existing rules preserved)");
      preserved.push(".claude/commands/ (existing commands preserved)");
    } else {
      created.push(
        ".claude/ (CLAUDE.md, settings.json, hooks, rules, commands)",
      );
    }
  }

  if (tools.includes("codex") && !existing.aiRulez) {
    if (existing.agentsDir) {
      replaced.push(".agents/CODEX.md");
      preserved.push(".agents/rules/ (existing rules preserved)");
    } else {
      created.push(".agents/ (CODEX.md, rules, plan)");
    }
  }

  if (tools.includes("cursor") && !existing.aiRulez) {
    created.push(".cursorrules");
  }

  if (tools.includes("copilot") && !existing.aiRulez) {
    created.push(".github/copilot-instructions.md");
  }

  if (useGitHub) {
    created.push(
      "GitHub workflows + templates (ci.yml, PR template, issue templates)",
    );
    if (!existing.checkAllScript) {
      created.push("scripts/check-all.mjs");
    } else {
      preserved.push("scripts/check-all.mjs (preserved)");
    }
  }

  return { replaced, preserved, merged, created };
}

export function displayMigrationPlan(plan: MigrationPlan): void {
  console.log("\n  Migration plan:");
  for (const entry of plan.replaced) {
    console.log(`  ├── Replace (backed up): ${entry}`);
  }
  for (const entry of plan.merged) {
    console.log(`  ├── Merge: ${entry}`);
  }
  for (const entry of plan.preserved) {
    console.log(`  ├── Preserve: ${entry}`);
  }
  for (const entry of plan.created) {
    console.log(`  ├── Create: ${entry}`);
  }
}

export async function runWizard(
  wizardInput: WizardInput,
): Promise<ProjectConfig | null> {
  console.log("");

  const flow = determineFlow(wizardInput.existing);

  if (flow === "brownfield") {
    console.log("  Existing governance detected:");
    if (wizardInput.existing.agentsMd) console.log("  ├── AGENTS.md");
    if (wizardInput.existing.claudeDir) console.log("  ├── .claude/ directory");
    if (wizardInput.existing.agentsDir) console.log("  ├── .agents/ directory");
    console.log("");
  }

  const githubChoice = buildGithubChoice(wizardInput.githubAccess);

  const answers = (await inquirer.prompt([
    {
      type: "input",
      name: "description",
      message: "Project description:",
      default: `${wizardInput.projectName} project`,
    },
    {
      type: "checkbox",
      name: "tools",
      message: "Which AI tools will you use?",
      choices: [
        { name: "Claude Code (Anthropic)", value: "claude", checked: true },
        { name: "Codex (OpenAI)", value: "codex", checked: true },
        { name: "Cursor", value: "cursor", checked: false },
        { name: "Copilot", value: "copilot", checked: false },
      ],
    },
    {
      type: "list",
      name: "governanceLevel",
      message: "Governance level:",
      choices: [
        {
          name: "L1 — Fast checks only (lint + format + unit tests)",
          value: "L1",
        },
        {
          name: "L2 — Full gate (L1 + coverage + integration)  [recommended]",
          value: "L2",
        },
        { name: "L3 — Audit grade (L2 + E2E + evidence)", value: "L3" },
      ],
      default: "L2",
    },
    ...githubChoice,
  ] as Parameters<typeof inquirer.prompt>[0])) as WizardAnswers;

  const tools =
    answers.tools.length > 0
      ? answers.tools
      : (["claude", "codex"] as AiTool[]);
  const useGitHub = answers.useGitHub === "yes";
  const config = buildConfigFromAnswers(wizardInput, answers);

  if (flow === "brownfield") {
    const plan = buildMigrationPlan(wizardInput.existing, tools, useGitHub);
    displayMigrationPlan(plan);
  } else {
    console.log(`\n  Will generate governance files for: ${tools.join(", ")}`);
  }

  const { confirm } = (await inquirer.prompt([
    {
      type: "confirm",
      name: "confirm",
      message: flow === "brownfield" ? "Proceed with migration?" : "Proceed?",
      default: true,
    },
  ] as Parameters<typeof inquirer.prompt>[0])) as { confirm: boolean };

  if (!confirm) {
    return null;
  }

  return config;
}

function buildConfigFromAnswers(
  input: WizardInput,
  answers: WizardAnswers,
): ProjectConfig {
  const tools =
    answers.tools.length > 0
      ? answers.tools
      : (["claude", "codex"] as AiTool[]);
  return {
    targetDir: input.targetDir,
    projectName: input.projectName,
    description: answers.description,
    language: input.language,
    framework: input.framework,
    buildTool: input.buildCmds.buildTool,
    buildCommand: input.buildCmds.buildCommand,
    testCommand: input.buildCmds.testCommand,
    lintCommand: input.buildCmds.lintCommand,
    formatCommand: input.buildCmds.formatCommand,
    tools,
    governanceLevel: answers.governanceLevel,
    useGitHub: answers.useGitHub === "yes",
    githubOwner: input.gitInfo.githubOwner,
    githubRepo: input.gitInfo.githubRepo,
    existing: input.existing,
    languageHooks: getLanguageHooks(input.language),
    enableDebtGates: answers.governanceLevel !== "L1",
  };
}

function buildGithubChoice(access: GithubAccess): object[] {
  if (!access.available) {
    return [];
  }
  if (!access.authenticated) {
    console.log(
      `  Note: ${access.error ?? "gh not authenticated — GitHub assets skipped"}`,
    );
    return [];
  }
  return [
    {
      type: "list",
      name: "useGitHub",
      message:
        "Generate GitHub assets? (.github/ workflows, templates, labels)",
      choices: [
        {
          name: `Yes — gh authenticated as ${access.username ?? "unknown"}`,
          value: "yes",
        },
        { name: "No — skip GitHub setup", value: "no" },
      ],
      default: "yes",
    },
  ];
}
