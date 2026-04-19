import inquirer from "inquirer";
import type {
  ProjectConfig,
  AiTool,
  Archetype,
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
import { presetToTiers, defaultPresetForLevel } from "../invariants/filter.js";
import { detectArchetypeHint } from "../detectors/framework.js";
import { ARCHETYPE_DB_SET } from "../detectors/axis.js";
import {
  defaultContractType,
  shouldAskContractType,
} from "./archetype-defaults.js";

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
  if (
    existing.agentsMd ||
    existing.claudeDir ||
    existing.agentsDir ||
    existing.geminiDir ||
    existing.windsurfRules ||
    existing.aiderConf
  ) {
    return "brownfield";
  }
  return "greenfield";
}

interface SimpleToolEntry {
  tool: AiTool;
  filePath: string;
  existsAlready: boolean;
}

function addSimpleToolFiles(
  tools: AiTool[],
  aiRulez: boolean,
  entries: SimpleToolEntry[],
  replaced: string[],
  created: string[],
): void {
  for (const { tool, filePath, existsAlready } of entries) {
    if (!tools.includes(tool) || aiRulez) continue;
    if (existsAlready) {
      replaced.push(filePath);
    } else {
      created.push(filePath);
    }
  }
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

  addSimpleToolFiles(
    tools,
    existing.aiRulez,
    [
      { tool: "cursor", filePath: ".cursorrules", existsAlready: false },
      {
        tool: "copilot",
        filePath: ".github/copilot-instructions.md",
        existsAlready: false,
      },
      {
        tool: "gemini",
        filePath: ".gemini/GEMINI.md",
        existsAlready: existing.geminiDir,
      },
      {
        tool: "windsurf",
        filePath: "windsurf-instructions.md",
        existsAlready: existing.windsurfRules,
      },
      {
        tool: "aider",
        filePath: ".aider.conf.yml",
        existsAlready: existing.aiderConf,
      },
    ],
    replaced,
    created,
  );

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
    if (wizardInput.existing.geminiDir) console.log("  ├── .gemini/ directory");
    if (wizardInput.existing.windsurfRules)
      console.log("  ├── windsurf-instructions.md");
    if (wizardInput.existing.aiderConf) console.log("  ├── .aider.conf.yml");
    console.log("");
  }

  const answers = (await inquirer.prompt(
    buildMainQuestions(wizardInput) as Parameters<typeof inquirer.prompt>[0],
  )) as WizardAnswers;

  const tools =
    answers.tools.length > 0
      ? answers.tools
      : (["claude", "codex"] as AiTool[]);
  const useGitHub = answers.useGitHub === "yes";

  const { enableObsidianVault } = (await inquirer.prompt([
    {
      type: "confirm",
      name: "enableObsidianVault",
      message: "Generate optional Obsidian vault at docs/vault/?",
      default: false,
    },
  ] as Parameters<typeof inquirer.prompt>[0])) as {
    enableObsidianVault: boolean;
  };

  const config = buildConfigFromAnswers(
    wizardInput,
    answers,
    enableObsidianVault,
  );

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
  enableObsidianVault: boolean,
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
    archetype: answers.archetype,
    architectureStyle: answers.architectureStyle,
    isMultiTenant: answers.isMultiTenant,
    hasDatabase: answers.hasDatabase,
    hasPublicApi: answers.hasPublicApi,
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
    enableSuppressions: true,
    enableSecurityScanning: answers.governanceLevel !== "L1",
    invariantTiers: presetToTiers(
      answers.invariantPreset ?? defaultPresetForLevel(answers.governanceLevel),
    ),
    enableObsidianVault,
    contractType:
      answers.contractType ??
      defaultContractType(answers.archetype, answers.hasPublicApi),
  };
}

function buildGovernanceQuestions(): object[] {
  return [
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
    {
      type: "list",
      name: "invariantPreset",
      message: "Invariant coverage:",
      choices: [
        {
          name: "Essential — architectural + governance rules only (~14 rules)",
          value: "essential",
        },
        {
          name: "Standard — + data integrity + operational rules (~23 rules)",
          value: "standard",
        },
        {
          name: "Full — all 28 rules including security tier",
          value: "full",
        },
      ],
      default: (answers: { governanceLevel: string }): string =>
        defaultPresetForLevel(
          answers.governanceLevel as import("./types.js").GovernanceLevel,
        ),
    },
  ];
}

function buildArchetypeQuestions(archetypeDefault: Archetype): object[] {
  return [
    {
      type: "list",
      name: "archetype",
      message: "Project archetype:",
      choices: [
        {
          name: "backend-web-db  — HTTP service with database",
          value: "backend-web-db",
        },
        { name: "cli             — Command-line tool", value: "cli" },
        {
          name: "library         — Reusable library / package",
          value: "library",
        },
        {
          name: "data-pipeline   — ETL / batch processing",
          value: "data-pipeline",
        },
        {
          name: "frontend-spa    — Browser / desktop UI",
          value: "frontend-spa",
        },
        {
          name: "embedded        — Firmware / bare-metal",
          value: "embedded",
        },
      ],
      default: archetypeDefault,
    },
    {
      type: "list",
      name: "architectureStyle",
      message: "Internal architecture style:",
      choices: [
        {
          name: "none            — No architecture rules generated  [default]",
          value: "none",
        },
        {
          name: "hexagonal       — Ports & adapters (e.g. Viafera-style)",
          value: "hexagonal",
        },
        {
          name: "layered         — Package-direction layers",
          value: "layered",
        },
        {
          name: "modular-monolith — Bounded-context module isolation",
          value: "modular-monolith",
        },
      ],
      default: "none",
    },
    {
      type: "list",
      name: "hasDatabase",
      message: "Does the project connect to a database?",
      choices: [
        { name: "Yes", value: true },
        { name: "No", value: false },
      ],
      default: (answers: { archetype: Archetype }): boolean =>
        ARCHETYPE_DB_SET.has(answers.archetype),
    },
    {
      type: "list",
      name: "hasPublicApi",
      message: "Does the project expose a public API?",
      choices: [
        { name: "Yes", value: true },
        { name: "No", value: false },
      ],
      default: (answers: { archetype: Archetype }): boolean =>
        answers.archetype === "backend-web-db",
    },
    {
      type: "list",
      name: "isMultiTenant",
      message: "Is the project multi-tenant?",
      choices: [
        { name: "Yes", value: true },
        { name: "No", value: false },
      ],
      default: false,
    },
    buildContractTypeQuestion(),
  ];
}

function buildContractTypeQuestion(): object {
  return {
    type: "list",
    name: "contractType",
    message: "Contract testing style:",
    // shouldAskContractType is a named export so it can be unit-tested directly.
    // The inquirer `when` function is NOT exercised by the mocked runWizard tests.
    when: (answers: { hasPublicApi?: boolean }) =>
      shouldAskContractType(answers),
    choices: [
      {
        name: "rest-owned     — Pact (consumer + provider you own)",
        value: "rest-owned",
      },
      {
        name: "rest-public    — OpenAPI diff (breaking-change detector)",
        value: "rest-public",
      },
      {
        name: "graphql        — Schema diff (graphql-inspector)",
        value: "graphql",
      },
      { name: "grpc           — buf breaking", value: "grpc" },
      {
        name: "message-queue  — Schema registry (Avro/Protobuf)",
        value: "message-queue",
      },
      { name: "none           — No contract testing", value: "none" },
    ],
    default: (answers: { archetype?: Archetype; hasPublicApi?: boolean }) =>
      defaultContractType(answers.archetype, answers.hasPublicApi ?? false),
  };
}

function buildMainQuestions(wizardInput: WizardInput): object[] {
  const githubChoice = buildGithubChoice(wizardInput.githubAccess);
  const archetypeDefault: Archetype =
    detectArchetypeHint(
      wizardInput.targetDir,
      wizardInput.language,
      wizardInput.framework,
    ) ?? "library";
  return [
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
        { name: "Gemini CLI (Google)", value: "gemini", checked: false },
        { name: "Windsurf (Codeium)", value: "windsurf", checked: false },
        { name: "Aider (terminal pair)", value: "aider", checked: false },
      ],
    },
    ...buildGovernanceQuestions(),
    ...buildArchetypeQuestions(archetypeDefault),
    ...githubChoice,
  ];
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
