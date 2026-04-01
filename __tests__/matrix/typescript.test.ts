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

describe("matrix: TypeScript project", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestProject("typescript");
    initGit(dir);
  });

  afterEach(() => {
    cleanupTestProject(dir);
  });

  function tsConfig(overrides: Partial<Parameters<typeof makeConfig>[1]> = {}) {
    return makeConfig(dir, {
      language: "typescript",
      framework: null,
      buildTool: "npm",
      buildCommand: "npm run build",
      testCommand: "npm test",
      lintCommand: "npm run lint",
      formatCommand: "npx prettier --check .",
      tools: ["claude", "codex"],
      useGitHub: true,
      githubOwner: "test-owner",
      githubRepo: "test-repo",
      languageHooks: getLanguageHooks("typescript"),
      ...overrides,
    });
  }

  it("generates AGENTS.md mentioning TypeScript", () => {
    const config = tsConfig();
    runGenerators(config);
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(content).toContain("typescript");
  });

  it("AGENTS.md includes no-any invariant for TypeScript", () => {
    const config = tsConfig();
    runGenerators(config);
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(content).toContain("No `any` type");
  });

  it("CI workflow uses npm commands", () => {
    const config = tsConfig();
    runGenerators(config);
    const ci = readFileSync(
      join(dir, ".github", "workflows", "ci.yml"),
      "utf-8",
    );
    expect(ci).toContain("npm ci");
    expect(ci).toContain("npm run lint");
    expect(ci).toContain("npm test");
  });

  it("CI workflow sets up Node.js", () => {
    const config = tsConfig();
    runGenerators(config);
    const ci = readFileSync(
      join(dir, ".github", "workflows", "ci.yml"),
      "utf-8",
    );
    expect(ci).toContain("setup-node");
    expect(ci).toContain("node-version: '20'");
  });

  it("check-all.mjs references eslint and prettier", () => {
    const config = tsConfig();
    runGenerators(config);
    const checkAll = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(checkAll).toContain("eslint");
    expect(checkAll).toContain("prettier");
  });

  it("generates check-no-any.mjs language hook", () => {
    const config = tsConfig();
    runGenerators(config);
    expect(existsSync(join(dir, ".claude", "hooks", "check-no-any.mjs"))).toBe(
      true,
    );
    const hook = readFileSync(
      join(dir, ".claude", "hooks", "check-no-any.mjs"),
      "utf-8",
    );
    expect(hook).toContain("any");
  });

  it("settings.json includes npm permissions", () => {
    const config = tsConfig();
    runGenerators(config);
    const settings = JSON.parse(
      readFileSync(join(dir, ".claude", "settings.json"), "utf-8"),
    ) as Record<string, unknown>;
    const permissions = settings["permissions"] as { allow?: string[] };
    expect(permissions.allow).toEqual(
      expect.arrayContaining(["Bash(npm run *)"]),
    );
  });

  it("settings.json includes check-no-any.mjs hook entry", () => {
    const config = tsConfig();
    runGenerators(config);
    const raw = readFileSync(join(dir, ".claude", "settings.json"), "utf-8");
    expect(raw).toContain("check-no-any.mjs");
  });

  it("AGENTS.md coding standards section is TypeScript-specific", () => {
    const config = tsConfig();
    runGenerators(config);
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(content).toContain("Strict mode always on");
    expect(content).toContain("kebab-case.ts");
    // Should NOT contain Java or Rust standards
    expect(content).not.toContain("Hexagonal architecture");
    expect(content).not.toContain(".unwrap()");
  });
});
