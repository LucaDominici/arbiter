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

describe("matrix: Rust project", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestProject("rust");
    initGit(dir);
  });

  afterEach(() => {
    cleanupTestProject(dir);
  });

  function rustConfig(
    overrides: Partial<Parameters<typeof makeConfig>[1]> = {},
  ) {
    return makeConfig(dir, {
      language: "rust",
      framework: null,
      buildTool: "cargo",
      buildCommand: "cargo build",
      testCommand: "cargo test",
      lintCommand: "cargo clippy -- -D warnings",
      formatCommand: "cargo fmt --check",
      tools: ["claude", "codex"],
      useGitHub: true,
      githubOwner: "test-owner",
      githubRepo: "test-repo",
      languageHooks: getLanguageHooks("rust"),
      ...overrides,
    });
  }

  it("generates AGENTS.md mentioning Rust", () => {
    const config = rustConfig();
    runGenerators(config);
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(content).toContain("rust");
  });

  it("AGENTS.md includes no-unwrap invariant", () => {
    const config = rustConfig();
    runGenerators(config);
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(content).toContain(".unwrap()");
    expect(content).toContain("explicit error handling");
  });

  it("CI workflow uses cargo commands", () => {
    const config = rustConfig();
    runGenerators(config);
    const ci = readFileSync(
      join(dir, ".github", "workflows", "ci.yml"),
      "utf-8",
    );
    expect(ci).toContain("cargo fmt --check");
    expect(ci).toContain("cargo clippy");
    expect(ci).toContain("cargo test");
  });

  it("CI workflow uses rust-toolchain setup", () => {
    const config = rustConfig();
    runGenerators(config);
    const ci = readFileSync(
      join(dir, ".github", "workflows", "ci.yml"),
      "utf-8",
    );
    expect(ci).toContain("rust-toolchain@stable");
    expect(ci).toContain("rust-cache");
  });

  it("check-all.mjs references cargo", () => {
    const config = rustConfig();
    runGenerators(config);
    const checkAll = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(checkAll).toContain("fmt");
    expect(checkAll).toContain("clippy");
    expect(checkAll).toContain("cargo");
  });

  it("generates check-no-unwrap.mjs language hook", () => {
    const config = rustConfig();
    runGenerators(config);
    expect(
      existsSync(join(dir, ".claude", "hooks", "check-no-unwrap.mjs")),
    ).toBe(true);
    const hook = readFileSync(
      join(dir, ".claude", "hooks", "check-no-unwrap.mjs"),
      "utf-8",
    );
    expect(hook).toContain(".unwrap()");
  });

  it("settings.json includes cargo permissions", () => {
    const config = rustConfig();
    runGenerators(config);
    const settings = JSON.parse(
      readFileSync(join(dir, ".claude", "settings.json"), "utf-8"),
    ) as Record<string, unknown>;
    const permissions = settings["permissions"] as { allow?: string[] };
    expect(permissions.allow).toEqual(
      expect.arrayContaining(["Bash(cargo *)"]),
    );
  });

  it("AGENTS.md coding standards are Rust-specific", () => {
    const config = rustConfig();
    runGenerators(config);
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(content).toContain("clippy::pedantic");
    expect(content).toContain("Result<T, E>");
    // Should NOT contain TypeScript or Java standards
    expect(content).not.toContain("Strict mode always on");
    expect(content).not.toContain("constructor injection");
  });
});
