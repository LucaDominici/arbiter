import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  createTestProject,
  initGit,
  cleanupTestProject,
  makeConfig,
} from "../helpers.js";
import { runGenerators } from "../../src/commands/init.js";
import { getLanguageHooks } from "../../src/detectors/language-hooks.js";

describe("matrix: Python project", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestProject("python");
    initGit(dir);
  });

  afterEach(() => {
    cleanupTestProject(dir);
  });

  function pythonConfig(
    overrides: Partial<Parameters<typeof makeConfig>[1]> = {},
  ) {
    return makeConfig(dir, {
      language: "python",
      framework: null,
      buildTool: "pip",
      buildCommand: "pip install -e .",
      testCommand: "pytest",
      lintCommand: "ruff check .",
      formatCommand: "ruff format --check .",
      tools: ["claude", "codex"],
      useGitHub: true,
      githubOwner: "test-owner",
      githubRepo: "test-repo",
      languageHooks: getLanguageHooks("python"),
      ...overrides,
    });
  }

  it("generates AGENTS.md mentioning Python", () => {
    const config = pythonConfig();
    runGenerators(config);
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(content).toContain("python");
  });

  it("AGENTS.md gate system references pytest and ruff commands", () => {
    const config = pythonConfig();
    runGenerators(config);
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(content).toContain("pytest");
    expect(content).toContain("ruff check");
    expect(content).toContain("ruff format");
  });

  it("AGENTS.md does not contain TypeScript/Rust/Java-specific invariants", () => {
    const config = pythonConfig();
    runGenerators(config);
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(content).not.toContain("No `any` type");
    expect(content).not.toContain(".unwrap()");
    expect(content).not.toContain("Hexagonal architecture");
  });

  it("generates all standard files", () => {
    const config = pythonConfig();
    const results = runGenerators(config);
    const paths = results.map((r) => r.path);
    expect(paths.some((p) => p.endsWith("AGENTS.md"))).toBe(true);
    expect(paths.some((p) => p.includes(".claude/CLAUDE.md"))).toBe(true);
    expect(paths.some((p) => p.includes(".agents/CODEX.md"))).toBe(true);
    expect(paths.some((p) => p.includes(".github/workflows/ci.yml"))).toBe(
      true,
    );
  });

  it("settings.json does not include npm or gradle permissions", () => {
    const config = pythonConfig();
    runGenerators(config);
    const settings = JSON.parse(
      readFileSync(join(dir, ".claude", "settings.json"), "utf-8"),
    ) as Record<string, unknown>;
    const permissions = settings["permissions"] as { allow?: string[] };
    expect(permissions.allow).not.toEqual(
      expect.arrayContaining(["Bash(npm run *)"]),
    );
    expect(permissions.allow).not.toEqual(
      expect.arrayContaining(["Bash(./gradlew *)"]),
    );
    expect(permissions.allow).not.toEqual(
      expect.arrayContaining(["Bash(cargo *)"]),
    );
  });

  it("AGENTS.md includes Python coding standards", () => {
    const config = pythonConfig();
    runGenerators(config);
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(content).toContain("Type annotations");
    expect(content).toContain("ruff");
    expect(content).toContain("pytest");
  });

  it("AGENTS.md includes Python invariants INV-04/INV-05", () => {
    const config = pythonConfig();
    runGenerators(config);
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(content).toContain("Type annotations required");
    expect(content).toContain("ruff check");
  });

  it("CI workflow uses Python setup and commands", () => {
    const config = pythonConfig();
    runGenerators(config);
    const ci = readFileSync(
      join(dir, ".github", "workflows", "ci.yml"),
      "utf-8",
    );
    expect(ci).toContain("setup-python");
    expect(ci).toContain("ruff");
    expect(ci).toContain("pytest");
  });

  it("check-all.mjs references Python commands", () => {
    const config = pythonConfig();
    runGenerators(config);
    const checkAll = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(checkAll).toContain("ruff");
    expect(checkAll).toContain("pytest");
  });

  it("settings.json includes Python permissions", () => {
    const config = pythonConfig();
    runGenerators(config);
    const settings = JSON.parse(
      readFileSync(join(dir, ".claude", "settings.json"), "utf-8"),
    ) as Record<string, unknown>;
    const permissions = settings["permissions"] as { allow?: string[] };
    expect(permissions.allow).toEqual(
      expect.arrayContaining([
        "Bash(python *)",
        "Bash(pip *)",
        "Bash(pytest *)",
        "Bash(ruff *)",
      ]),
    );
  });

  it("generates check-no-bare-except.mjs language hook", () => {
    const config = pythonConfig();
    runGenerators(config);
    const hookPath = join(
      dir,
      ".claude",
      "hooks",
      "check-no-bare-except.mjs",
    );
    expect(existsSync(hookPath)).toBe(true);
    const content = readFileSync(hookPath, "utf-8");
    expect(content).toContain(".py");
  });

  it("dependabot.yml includes pip ecosystem", () => {
    const config = pythonConfig();
    runGenerators(config);
    const dependabot = readFileSync(
      join(dir, ".github", "dependabot.yml"),
      "utf-8",
    );
    expect(dependabot).toContain("pip");
  });
});
