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

describe("matrix: Go project", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestProject("go");
    initGit(dir);
  });

  afterEach(() => {
    cleanupTestProject(dir);
  });

  function goConfig(overrides: Partial<Parameters<typeof makeConfig>[1]> = {}) {
    return makeConfig(dir, {
      language: "go",
      framework: null,
      buildTool: "go",
      buildCommand: "go build ./...",
      testCommand: "go test ./...",
      lintCommand: "golangci-lint run",
      formatCommand: "gofmt -l .",
      tools: ["claude", "codex"],
      useGitHub: true,
      githubOwner: "test-owner",
      githubRepo: "test-repo",
      languageHooks: getLanguageHooks("go"),
      ...overrides,
    });
  }

  it("generates AGENTS.md mentioning Go", () => {
    const config = goConfig();
    runGenerators(config);
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(content).toContain("go");
  });

  it("AGENTS.md gate system references go commands", () => {
    const config = goConfig();
    runGenerators(config);
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(content).toContain("golangci-lint run");
    expect(content).toContain("go test ./...");
  });

  it("AGENTS.md does not contain TypeScript/Rust/Java-specific invariants", () => {
    const config = goConfig();
    runGenerators(config);
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    // Go doesn't have language-specific invariants in the template
    expect(content).not.toContain("No `any` type");
    expect(content).not.toContain(".unwrap()");
    expect(content).not.toContain("Hexagonal architecture");
  });

  it("generates all standard files (AGENTS.md, .claude/, .agents/, GitHub)", () => {
    const config = goConfig();
    const results = runGenerators(config);
    const paths = results.map((r) => r.path);
    expect(paths.some((p) => p.endsWith("AGENTS.md"))).toBe(true);
    expect(paths.some((p) => p.includes(".claude/CLAUDE.md"))).toBe(true);
    expect(paths.some((p) => p.includes(".agents/CODEX.md"))).toBe(true);
    expect(paths.some((p) => p.includes(".github/workflows/ci.yml"))).toBe(
      true,
    );
  });

  it("CODEX.md and CLAUDE.md are thin pointers referencing AGENTS.md", () => {
    const config = goConfig();
    runGenerators(config);
    const claude = readFileSync(join(dir, ".claude", "CLAUDE.md"), "utf-8");
    const codex = readFileSync(join(dir, ".agents", "CODEX.md"), "utf-8");
    expect(claude).toContain("AGENTS.md");
    expect(codex).toContain("AGENTS.md");
  });

  it("AGENTS.md includes Go coding standards", () => {
    const config = goConfig();
    runGenerators(config);
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(content).toContain("gofmt");
    expect(content).toContain("error handling");
    expect(content).toContain("golangci-lint");
  });

  it("AGENTS.md includes Go invariants INV-04/INV-05", () => {
    const config = goConfig();
    runGenerators(config);
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(content).toContain("explicit error handling");
    expect(content).toContain("go vet");
  });

  it("CI workflow uses Go setup and commands", () => {
    const config = goConfig();
    runGenerators(config);
    const ci = readFileSync(
      join(dir, ".github", "workflows", "ci.yml"),
      "utf-8",
    );
    expect(ci).toContain("setup-go");
    expect(ci).toContain("golangci-lint");
    expect(ci).toContain("go test");
  });

  it("check-all.mjs references Go commands", () => {
    const config = goConfig();
    runGenerators(config);
    const checkAll = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(checkAll).toContain("vet");
    expect(checkAll).toContain("golangci-lint");
    expect(checkAll).toContain("go test");
  });

  it("settings.json includes Go permissions", () => {
    const config = goConfig();
    runGenerators(config);
    const settings = JSON.parse(
      readFileSync(join(dir, ".claude", "settings.json"), "utf-8"),
    ) as Record<string, unknown>;
    const permissions = settings["permissions"] as { allow?: string[] };
    expect(permissions.allow).toEqual(
      expect.arrayContaining(["Bash(go *)", "Bash(golangci-lint *)"]),
    );
  });

  it("generates check-no-unchecked-err.mjs language hook", () => {
    const config = goConfig();
    runGenerators(config);
    const hookPath = join(dir, ".claude", "hooks", "check-no-unchecked-err.mjs");
    expect(existsSync(hookPath)).toBe(true);
    const content = readFileSync(hookPath, "utf-8");
    expect(content).toContain(".go");
  });

  it("dependabot.yml includes gomod ecosystem", () => {
    const config = goConfig();
    runGenerators(config);
    const dependabot = readFileSync(
      join(dir, ".github", "dependabot.yml"),
      "utf-8",
    );
    expect(dependabot).toContain("gomod");
  });
});
