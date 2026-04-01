import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  createTestProject,
  initGit,
  cleanupTestProject,
  makeConfig,
} from "../helpers.js";
import { generateClaude } from "../../src/generators/claude.js";
import { getLanguageHooks } from "../../src/detectors/language-hooks.js";

describe("tool output: claude", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestProject("typescript");
    initGit(dir);
  });

  afterEach(() => {
    cleanupTestProject(dir);
  });

  function claudeConfig(
    overrides: Partial<Parameters<typeof makeConfig>[1]> = {},
  ) {
    return makeConfig(dir, { languageHooks: [], ...overrides });
  }

  it("CLAUDE.md is a thin pointer with @AGENTS.md directive and project name", () => {
    const config = claudeConfig();
    generateClaude(config);
    const content = readFileSync(join(dir, ".claude", "CLAUDE.md"), "utf-8");
    expect(content).toContain("@AGENTS.md");
    expect(content).toContain("test-project");
  });

  it("CLAUDE.md hooks table references all base hook scripts", () => {
    const config = claudeConfig();
    generateClaude(config);
    const content = readFileSync(join(dir, ".claude", "CLAUDE.md"), "utf-8");
    expect(content).toContain("stop-dangerous.sh");
    expect(content).toContain("enforce-read-only.sh");
    expect(content).toContain("pre-edit-ssot-guard.sh");
  });

  it("settings.json is valid JSON with hooks and permissions keys", () => {
    const config = claudeConfig();
    generateClaude(config);
    const raw = readFileSync(join(dir, ".claude", "settings.json"), "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed).toHaveProperty("hooks");
    expect(parsed).toHaveProperty("permissions");
  });

  it("settings.json PreToolUse has Bash and Edit|Write matchers", () => {
    const config = claudeConfig();
    generateClaude(config);
    const raw = readFileSync(join(dir, ".claude", "settings.json"), "utf-8");
    const parsed = JSON.parse(raw) as {
      hooks: { PreToolUse: Array<{ matcher: string }> };
    };
    const matchers = parsed.hooks.PreToolUse.map((h) => h.matcher);
    expect(matchers).toContain("Bash");
    expect(matchers).toContain("Edit|Write");
  });

  it("settings.json PostToolUse has Bash and Edit|Write matchers", () => {
    const config = claudeConfig();
    generateClaude(config);
    const raw = readFileSync(join(dir, ".claude", "settings.json"), "utf-8");
    const parsed = JSON.parse(raw) as {
      hooks: { PostToolUse: Array<{ matcher: string }> };
    };
    const matchers = parsed.hooks.PostToolUse.map((h) => h.matcher);
    expect(matchers).toContain("Bash");
    expect(matchers).toContain("Edit|Write");
  });

  it("settings.json deny list blocks rm -rf and force push", () => {
    const config = claudeConfig();
    generateClaude(config);
    const raw = readFileSync(join(dir, ".claude", "settings.json"), "utf-8");
    const parsed = JSON.parse(raw) as { permissions: { deny: string[] } };
    const deny = parsed.permissions.deny;
    expect(deny.some((d) => d.includes("rm -rf"))).toBe(true);
    expect(deny.some((d) => d.includes("force"))).toBe(true);
  });

  it("generates 4 static hook scripts in .claude/hooks/", () => {
    const config = claudeConfig();
    generateClaude(config);
    const hooksDir = join(dir, ".claude", "hooks");
    const staticHooks = [
      "stop-dangerous.sh",
      "enforce-read-only.sh",
      "pre-edit-ssot-guard.sh",
      "check-no-orphan-todo.sh",
    ];
    for (const name of staticHooks) {
      expect(existsSync(join(hooksDir, name)), `${name} should exist`).toBe(
        true,
      );
    }
  });

  it("lib.sh contains project name", () => {
    const config = claudeConfig();
    generateClaude(config);
    const content = readFileSync(
      join(dir, ".claude", "hooks", "lib.sh"),
      "utf-8",
    );
    expect(content).toContain("test-project");
  });

  it("post-commit-check.sh contains conventional commit regex", () => {
    const config = claudeConfig();
    generateClaude(config);
    const content = readFileSync(
      join(dir, ".claude", "hooks", "post-commit-check.sh"),
      "utf-8",
    );
    expect(content).toContain("grep -qE");
    expect(content).toContain("feat");
  });

  it("generates 3 rules files in .claude/rules/", () => {
    const config = claudeConfig();
    generateClaude(config);
    const rulesDir = join(dir, ".claude", "rules");
    expect(existsSync(join(rulesDir, "05-agent-lifecycle.md"))).toBe(true);
    expect(existsSync(join(rulesDir, "25-todo-folder-policy.md"))).toBe(true);
    expect(existsSync(join(rulesDir, "90-exec-protocol.md"))).toBe(true);
  });

  it("generates 2 command files; start-task.md references gh issue view", () => {
    const config = claudeConfig();
    generateClaude(config);
    const commandsDir = join(dir, ".claude", "commands");
    expect(existsSync(join(commandsDir, "start-task.md"))).toBe(true);
    expect(existsSync(join(commandsDir, "complete-task.md"))).toBe(true);
    const startTask = readFileSync(join(commandsDir, "start-task.md"), "utf-8");
    expect(startTask).toContain("gh issue view");
  });

  it("TypeScript language hooks generate check-no-any.sh", () => {
    const config = claudeConfig({
      languageHooks: getLanguageHooks("typescript"),
    });
    generateClaude(config);
    expect(existsSync(join(dir, ".claude", "hooks", "check-no-any.sh"))).toBe(
      true,
    );
  });
});
