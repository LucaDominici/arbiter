import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createTestProject,
  initGit,
  cleanupTestProject,
  makeConfig,
} from "../helpers.js";
import { generateCursor } from "../../src/generators/cursor.js";

describe("tool output: cursor", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestProject("typescript");
    initGit(dir);
  });

  afterEach(() => {
    cleanupTestProject(dir);
  });

  function cursorConfig(
    overrides: Partial<Parameters<typeof makeConfig>[1]> = {},
  ) {
    return makeConfig(dir, {
      tools: ["cursor"],
      languageHooks: [],
      ...overrides,
    });
  }

  it("generates .cursorrules at project root", () => {
    const config = cursorConfig();
    const result = generateCursor(config);
    expect(existsSync(join(dir, ".cursorrules"))).toBe(true);
    expect(result.files).toHaveLength(1);
  });

  it(".cursorrules references AGENTS.md as canonical source", () => {
    const config = cursorConfig();
    generateCursor(config);
    const content = readFileSync(join(dir, ".cursorrules"), "utf-8");
    expect(content).toContain("AGENTS.md");
    expect(content).toContain("canonical");
  });

  it(".cursorrules contains project name", () => {
    const config = cursorConfig();
    generateCursor(config);
    const content = readFileSync(join(dir, ".cursorrules"), "utf-8");
    expect(content).toContain("test-project");
  });

  it(".cursorrules includes TypeScript build and test commands", () => {
    const config = cursorConfig();
    generateCursor(config);
    const content = readFileSync(join(dir, ".cursorrules"), "utf-8");
    expect(content).toContain("npm run build");
    expect(content).toContain("npm test");
  });

  it(".cursorrules reflects Java/Spring framework in stack table", () => {
    const config = cursorConfig({
      language: "java",
      framework: "spring-boot",
      buildTool: "gradle",
      buildCommand: "./gradlew build",
      testCommand: "./gradlew test",
    });
    generateCursor(config);
    const content = readFileSync(join(dir, ".cursorrules"), "utf-8");
    expect(content).toContain("java");
    expect(content).toContain("spring-boot");
  });

  it(".cursorrules gate commands section references check-all.mjs L1 and L2", () => {
    const config = cursorConfig();
    generateCursor(config);
    const content = readFileSync(join(dir, ".cursorrules"), "utf-8");
    expect(content).toContain("node scripts/check-all.mjs L1");
    expect(content).toContain("node scripts/check-all.mjs L2");
  });

  it(".cursorrules contains Cursor-specific rules (cursorignore and AGENTS.md before task)", () => {
    const config = cursorConfig();
    generateCursor(config);
    const content = readFileSync(join(dir, ".cursorrules"), "utf-8");
    expect(content).toContain("cursorignore");
    expect(content).toContain("AGENTS.md");
  });

  it("backs up and replaces pre-existing .cursorrules", () => {
    writeFileSync(join(dir, ".cursorrules"), "# old rules");
    const config = cursorConfig();
    const result = generateCursor(config);
    expect(result.files[0].action).toBe("backed-up-and-replaced");
  });
});
