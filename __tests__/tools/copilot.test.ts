import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  createTestProject,
  initGit,
  cleanupTestProject,
  makeConfig,
} from "../helpers.js";
import { generateCopilot } from "../../src/generators/copilot.js";

describe("tool output: copilot", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestProject("typescript");
    initGit(dir);
  });

  afterEach(() => {
    cleanupTestProject(dir);
  });

  function copilotConfig(
    overrides: Partial<Parameters<typeof makeConfig>[1]> = {},
  ) {
    return makeConfig(dir, {
      tools: ["copilot"],
      languageHooks: [],
      ...overrides,
    });
  }

  it("generates copilot-instructions.md under .github/", () => {
    const config = copilotConfig();
    const result = generateCopilot(config);
    expect(existsSync(join(dir, ".github", "copilot-instructions.md"))).toBe(
      true,
    );
    expect(result.files).toHaveLength(1);
  });

  it("copilot-instructions.md references AGENTS.md as canonical source", () => {
    const config = copilotConfig();
    generateCopilot(config);
    const content = readFileSync(
      join(dir, ".github", "copilot-instructions.md"),
      "utf-8",
    );
    expect(content).toContain("AGENTS.md");
    expect(content).toContain("canonical");
  });

  it("copilot-instructions.md includes project context table", () => {
    const config = copilotConfig();
    generateCopilot(config);
    const content = readFileSync(
      join(dir, ".github", "copilot-instructions.md"),
      "utf-8",
    );
    expect(content).toContain("test-project");
    expect(content).toContain("typescript");
    expect(content).toContain("npm run build");
    expect(content).toContain("npm test");
  });

  it("copilot-instructions.md contains code generation rules", () => {
    const config = copilotConfig();
    generateCopilot(config);
    const content = readFileSync(
      join(dir, ".github", "copilot-instructions.md"),
      "utf-8",
    );
    expect(content).toContain("task/#NNN");
    expect(content).toContain("check-all.sh");
  });

  it("copilot-instructions.md has Do Not Generate section", () => {
    const config = copilotConfig();
    generateCopilot(config);
    const content = readFileSync(
      join(dir, ".github", "copilot-instructions.md"),
      "utf-8",
    );
    expect(content).toContain("Do Not Generate");
    expect(content).toContain("any");
    expect(content).toContain("main");
  });

  it("copilot-instructions.md includes configured lint command", () => {
    const config = copilotConfig({ lintCommand: "npm run lint" });
    generateCopilot(config);
    const content = readFileSync(
      join(dir, ".github", "copilot-instructions.md"),
      "utf-8",
    );
    expect(content).toContain("npm run lint");
  });

  it("copilot-instructions.md reflects Rust language and cargo build command", () => {
    const config = copilotConfig({
      language: "rust",
      buildTool: "cargo",
      buildCommand: "cargo build",
      testCommand: "cargo test",
      lintCommand: "cargo clippy",
    });
    generateCopilot(config);
    const content = readFileSync(
      join(dir, ".github", "copilot-instructions.md"),
      "utf-8",
    );
    expect(content).toContain("rust");
    expect(content).toContain("cargo build");
  });

  it("backs up and replaces pre-existing copilot-instructions.md", () => {
    const ghDir = join(dir, ".github");
    mkdirSync(ghDir, { recursive: true });
    writeFileSync(join(ghDir, "copilot-instructions.md"), "# old instructions");
    const config = copilotConfig();
    const result = generateCopilot(config);
    expect(result.files[0].action).toBe("backed-up-and-replaced");
  });
});
