import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  createTestProject,
  initGit,
  cleanupTestProject,
  makeConfig,
} from "../helpers.js";
import { runGenerators } from "../../src/commands/init.js";
import { getLanguageHooks } from "../../src/detectors/language-hooks.js";

describe("brownfield: existing .claude/ directory", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestProject("typescript");
    initGit(dir);
  });

  afterEach(() => {
    cleanupTestProject(dir);
  });

  function configWithExistingClaude(
    extraExisting: Partial<Parameters<typeof makeConfig>[1]["existing"]> = {},
  ) {
    return makeConfig(dir, {
      language: "typescript",
      buildTool: "npm",
      buildCommand: "npm run build",
      testCommand: "npm test",
      lintCommand: "npm run lint",
      formatCommand: "npx prettier --check .",
      tools: ["claude"],
      useGitHub: false,
      languageHooks: getLanguageHooks("typescript"),
      existing: {
        agentsMd: false,
        claudeDir: true,
        agentsDir: false,
        aiRulez: false,
        settingsJson: false,
        checkAllScript: false,
        ...extraExisting,
      },
    });
  }

  it("preserves custom hook files (skipIfExists)", () => {
    // Pre-create .claude/hooks/ with a custom hook
    const hooksDir = join(dir, ".claude", "hooks");
    mkdirSync(hooksDir, { recursive: true });
    const customHook = '#!/usr/bin/env bash\necho "custom hook"';
    writeFileSync(join(hooksDir, "stop-dangerous.mjs"), customHook);

    const config = configWithExistingClaude();
    runGenerators(config);

    // Custom hook should NOT be overwritten
    const content = readFileSync(join(hooksDir, "stop-dangerous.mjs"), "utf-8");
    expect(content).toBe(customHook);
  });

  it("replaces CLAUDE.md with backup when pre-existing", () => {
    const claudeDir = join(dir, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    const original = "# My Custom CLAUDE.md\nThis was hand-written.";
    writeFileSync(join(claudeDir, "CLAUDE.md"), original);

    const config = configWithExistingClaude();
    runGenerators(config);

    // Backup should exist
    expect(existsSync(join(claudeDir, "CLAUDE.md.arbiter-backup"))).toBe(true);
    const backup = readFileSync(
      join(claudeDir, "CLAUDE.md.arbiter-backup"),
      "utf-8",
    );
    expect(backup).toBe(original);

    // New CLAUDE.md should reference AGENTS.md
    const newContent = readFileSync(join(claudeDir, "CLAUDE.md"), "utf-8");
    expect(newContent).toContain("AGENTS.md");
  });

  it("preserves custom rules (skipIfExists)", () => {
    const rulesDir = join(dir, ".claude", "rules");
    mkdirSync(rulesDir, { recursive: true });
    const customRule = "# Custom rule that should not be overwritten";
    writeFileSync(join(rulesDir, "05-agent-lifecycle.md"), customRule);

    const config = configWithExistingClaude();
    runGenerators(config);

    const content = readFileSync(
      join(rulesDir, "05-agent-lifecycle.md"),
      "utf-8",
    );
    expect(content).toBe(customRule);
  });

  it("preserves custom commands (skipIfExists)", () => {
    const cmdsDir = join(dir, ".claude", "commands");
    mkdirSync(cmdsDir, { recursive: true });
    const customCmd = "# Custom task command\nDo something special.";
    writeFileSync(join(cmdsDir, "task.md"), customCmd);

    const config = configWithExistingClaude();
    runGenerators(config);

    const content = readFileSync(join(cmdsDir, "task.md"), "utf-8");
    expect(content).toBe(customCmd);
  });
});
