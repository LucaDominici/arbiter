import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  createTestProject,
  initGit,
  cleanupTestProject,
  makeConfig,
} from "../helpers.js";
import { runGenerators } from "../../src/commands/init.js";
import { getLanguageHooks } from "../../src/detectors/language-hooks.js";

describe("brownfield: ai-rulez coexistence", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestProject("typescript");
    initGit(dir);
    // Simulate an ai-rulez managed project
    writeFileSync(
      join(dir, "ai-rulez.yml"),
      "version: 1\ntools:\n  - claude\n  - codex\n",
    );
  });

  afterEach(() => {
    cleanupTestProject(dir);
  });

  function configWithAiRulez() {
    return makeConfig(dir, {
      language: "typescript",
      buildTool: "npm",
      buildCommand: "npm run build",
      testCommand: "npm test",
      lintCommand: "npm run lint",
      formatCommand: "npx prettier --check .",
      tools: [
        "claude",
        "codex",
        "cursor",
        "copilot",
        "gemini",
        "windsurf",
        "aider",
      ],
      useGitHub: true,
      githubOwner: "test-owner",
      githubRepo: "test-repo",
      languageHooks: getLanguageHooks("typescript"),
      existing: {
        agentsMd: false,
        claudeDir: false,
        agentsDir: false,
        aiRulez: true,
        settingsJson: false,
        checkAllScript: false,
        geminiDir: false,
        windsurfRules: false,
        aiderConf: false,
      },
    });
  }

  it("always generates AGENTS.md even with ai-rulez", () => {
    const config = configWithAiRulez();
    runGenerators(config);
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(true);
  });

  it("does NOT generate .claude/ directory when ai-rulez is present", () => {
    const config = configWithAiRulez();
    runGenerators(config);
    expect(existsSync(join(dir, ".claude", "CLAUDE.md"))).toBe(false);
    expect(existsSync(join(dir, ".claude", "settings.json"))).toBe(false);
  });

  it("does NOT generate .agents/ directory when ai-rulez is present", () => {
    const config = configWithAiRulez();
    runGenerators(config);
    expect(existsSync(join(dir, ".agents", "CODEX.md"))).toBe(false);
  });

  it("does NOT generate .cursorrules when ai-rulez is present", () => {
    const config = configWithAiRulez();
    runGenerators(config);
    expect(existsSync(join(dir, ".cursorrules"))).toBe(false);
  });

  it("does NOT generate copilot-instructions.md when ai-rulez is present", () => {
    const config = configWithAiRulez();
    runGenerators(config);
    expect(existsSync(join(dir, ".github", "copilot-instructions.md"))).toBe(
      false,
    );
  });

  it("still generates GitHub infra files (CI, PR template, etc.)", () => {
    const config = configWithAiRulez();
    runGenerators(config);
    expect(existsSync(join(dir, ".github", "workflows", "ci.yml"))).toBe(true);
    expect(existsSync(join(dir, ".github", "PULL_REQUEST_TEMPLATE.md"))).toBe(
      true,
    );
    expect(existsSync(join(dir, ".github", "dependabot.yml"))).toBe(true);
  });

  it("still generates root files (SECURITY.md, CONTRIBUTING.md, check-all.mjs)", () => {
    const config = configWithAiRulez();
    runGenerators(config);
    expect(existsSync(join(dir, "SECURITY.md"))).toBe(true);
    expect(existsSync(join(dir, "CONTRIBUTING.md"))).toBe(true);
    expect(existsSync(join(dir, "scripts", "check-all.mjs"))).toBe(true);
  });

  it("result set only contains AGENTS.md + GitHub + root files (no tool configs)", () => {
    const config = configWithAiRulez();
    const results = runGenerators(config);
    const paths = results.map((r) => r.path);

    // Should NOT contain tool-specific paths
    expect(paths.every((p) => !p.includes(".claude/"))).toBe(true);
    expect(paths.every((p) => !p.includes(".agents/"))).toBe(true);
    expect(paths.every((p) => !p.endsWith(".cursorrules"))).toBe(true);
    expect(paths.every((p) => !p.endsWith("copilot-instructions.md"))).toBe(
      true,
    );

    // Should contain AGENTS.md + GitHub + root
    expect(paths.some((p) => p.endsWith("AGENTS.md"))).toBe(true);
    expect(paths.some((p) => p.includes(".github/"))).toBe(true);
  });
});
