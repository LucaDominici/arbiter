import { describe, it, expect, vi, beforeEach } from "vitest";
import inquirer from "inquirer";
import {
  determineFlow,
  buildMigrationPlan,
  runWizard,
} from "../../src/wizard/prompts.js";
import type { WizardInput } from "../../src/wizard/prompts.js";
import type { ExistingState } from "../../src/detectors/existing.js";

vi.mock("inquirer", () => ({
  default: { prompt: vi.fn() },
}));

const mockPrompt = vi.mocked(inquirer.prompt);

function makeExisting(overrides: Partial<ExistingState> = {}): ExistingState {
  return {
    agentsMd: false,
    claudeDir: false,
    agentsDir: false,
    aiRulez: false,
    settingsJson: false,
    checkAllScript: false,
    ...overrides,
  };
}

function makeWizardInput(
  existing: ExistingState = makeExisting(),
): WizardInput {
  return {
    targetDir: "/tmp/test",
    projectName: "test-project",
    language: "typescript",
    framework: null,
    buildCmds: {
      buildTool: "npm",
      buildCommand: "npm run build",
      testCommand: "npm test",
      lintCommand: "npm run lint",
      formatCommand: "npx prettier --check .",
    },
    gitInfo: {
      isGitRepo: true,
      remoteUrl: null,
      githubOwner: null,
      githubRepo: null,
      projectName: "test-project",
    },
    existing,
    githubAccess: {
      available: false,
      authenticated: false,
      username: null,
      error: null,
    },
  };
}

describe("determineFlow", () => {
  it("returns greenfield when no governance files detected", () => {
    expect(determineFlow(makeExisting())).toBe("greenfield");
  });

  it("returns brownfield when AGENTS.md exists", () => {
    expect(determineFlow(makeExisting({ agentsMd: true }))).toBe("brownfield");
  });

  it("returns brownfield when .claude/ dir exists", () => {
    expect(determineFlow(makeExisting({ claudeDir: true }))).toBe("brownfield");
  });

  it("returns brownfield when .agents/ dir exists", () => {
    expect(determineFlow(makeExisting({ agentsDir: true }))).toBe("brownfield");
  });

  it("returns greenfield when only settingsJson or checkAllScript set", () => {
    expect(
      determineFlow(makeExisting({ settingsJson: true, checkAllScript: true })),
    ).toBe("greenfield");
  });
});

describe("buildMigrationPlan", () => {
  it("puts AGENTS.md in replaced when agentsMd=true", () => {
    const existing = makeExisting({ agentsMd: true });
    const plan = buildMigrationPlan(existing, ["claude"], false);
    expect(plan.replaced.some((s) => s.includes("AGENTS.md"))).toBe(true);
    expect(plan.created.some((s) => s.includes("AGENTS.md"))).toBe(false);
  });

  it("puts AGENTS.md in created when agentsMd=false", () => {
    const existing = makeExisting();
    const plan = buildMigrationPlan(existing, ["claude"], false);
    expect(plan.created.some((s) => s.includes("AGENTS.md"))).toBe(true);
  });

  it("puts settings.json in merged when settingsJson=true and claude selected", () => {
    const existing = makeExisting({ claudeDir: true, settingsJson: true });
    const plan = buildMigrationPlan(existing, ["claude"], false);
    expect(plan.merged.some((s) => s.includes("settings.json"))).toBe(true);
  });

  it("puts existing .claude/ hooks in preserved when claudeDir=true", () => {
    const existing = makeExisting({ claudeDir: true });
    const plan = buildMigrationPlan(existing, ["claude"], false);
    expect(plan.preserved.some((s) => s.includes("hooks"))).toBe(true);
  });

  it("puts .claude/CLAUDE.md in replaced when claudeDir=true", () => {
    const existing = makeExisting({ claudeDir: true });
    const plan = buildMigrationPlan(existing, ["claude"], false);
    expect(plan.replaced.some((s) => s.includes("CLAUDE.md"))).toBe(true);
  });

  it("puts .agents/CODEX.md in replaced when agentsDir=true and codex selected", () => {
    const existing = makeExisting({ agentsDir: true });
    const plan = buildMigrationPlan(existing, ["codex"], false);
    expect(plan.replaced.some((s) => s.includes("CODEX.md"))).toBe(true);
  });

  it("includes github workflows in created when useGitHub=true", () => {
    const plan = buildMigrationPlan(makeExisting(), ["claude"], true);
    expect(plan.created.some((s) => s.toLowerCase().includes("github"))).toBe(
      true,
    );
  });
});

describe("runWizard greenfield flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns config when user confirms", async () => {
    mockPrompt
      .mockResolvedValueOnce({
        description: "my project",
        tools: ["claude"],
        governanceLevel: "L2",
      })
      .mockResolvedValueOnce({ confirm: true });

    const result = await runWizard(makeWizardInput());
    expect(result).not.toBeNull();
    expect(result!.tools).toEqual(["claude"]);
    expect(result!.governanceLevel).toBe("L2");
  });

  it("returns null when user cancels at confirmation", async () => {
    mockPrompt
      .mockResolvedValueOnce({
        description: "my project",
        tools: ["claude"],
        governanceLevel: "L2",
      })
      .mockResolvedValueOnce({ confirm: false });

    const result = await runWizard(makeWizardInput());
    expect(result).toBeNull();
  });

  it("defaults to claude+codex when no tools selected", async () => {
    mockPrompt
      .mockResolvedValueOnce({
        description: "my project",
        tools: [],
        governanceLevel: "L1",
      })
      .mockResolvedValueOnce({ confirm: true });

    const result = await runWizard(makeWizardInput());
    expect(result!.tools).toEqual(["claude", "codex"]);
  });
});

describe("runWizard brownfield flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns config when user confirms migration", async () => {
    const existing = makeExisting({ agentsMd: true, claudeDir: true });

    mockPrompt
      .mockResolvedValueOnce({
        description: "my project",
        tools: ["claude"],
        governanceLevel: "L2",
      })
      .mockResolvedValueOnce({ confirm: true });

    const result = await runWizard(makeWizardInput(existing));
    expect(result).not.toBeNull();
    expect(result!.tools).toEqual(["claude"]);
  });

  it("returns null when user cancels migration", async () => {
    const existing = makeExisting({ agentsMd: true });

    mockPrompt
      .mockResolvedValueOnce({
        description: "my project",
        tools: ["claude"],
        governanceLevel: "L2",
      })
      .mockResolvedValueOnce({ confirm: false });

    const result = await runWizard(makeWizardInput(existing));
    expect(result).toBeNull();
  });
});
