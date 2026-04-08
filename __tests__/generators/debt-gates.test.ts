import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createTestProject,
  initGit,
  cleanupTestProject,
  makeConfig,
} from "../helpers.js";
import { generateDebtGates } from "../../src/generators/debt-gates.js";

describe("generateDebtGates", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestProject("typescript");
    initGit(dir);
  });

  afterEach(() => {
    cleanupTestProject(dir);
  });

  it("returns empty files array when enableDebtGates is false", () => {
    const config = makeConfig(dir, { enableDebtGates: false });
    const result = generateDebtGates(config);
    expect(result.files).toHaveLength(0);
  });

  it("generates knip.json for TypeScript projects", () => {
    const config = makeConfig(dir, {
      language: "typescript",
      enableDebtGates: true,
    });
    const result = generateDebtGates(config);
    expect(result.files.some((f) => f.path.endsWith("knip.json"))).toBe(true);
    expect(existsSync(join(dir, "knip.json"))).toBe(true);
  });

  it("knip.json contains valid JSON with project and entry fields", () => {
    const config = makeConfig(dir, {
      language: "typescript",
      enableDebtGates: true,
    });
    generateDebtGates(config);
    const content = readFileSync(join(dir, "knip.json"), "utf-8");
    const parsed = JSON.parse(content) as Record<string, unknown>;
    expect(parsed).toHaveProperty("entry");
    expect(parsed).toHaveProperty("project");
  });

  it("does not generate knip.json for non-TypeScript projects", () => {
    cleanupTestProject(dir);
    dir = createTestProject("go");
    const config = makeConfig(dir, {
      language: "go",
      enableDebtGates: true,
    });
    generateDebtGates(config);
    expect(existsSync(join(dir, "knip.json"))).toBe(false);
  });

  it("generates .golangci.yml for Go projects", () => {
    cleanupTestProject(dir);
    dir = createTestProject("go");
    const config = makeConfig(dir, {
      language: "go",
      buildTool: "go",
      enableDebtGates: true,
    });
    const result = generateDebtGates(config);
    expect(result.files.some((f) => f.path.endsWith(".golangci.yml"))).toBe(
      true,
    );
    expect(existsSync(join(dir, ".golangci.yml"))).toBe(true);
  });

  it(".golangci.yml enables gocyclo and deadcode linters", () => {
    cleanupTestProject(dir);
    dir = createTestProject("go");
    const config = makeConfig(dir, {
      language: "go",
      buildTool: "go",
      enableDebtGates: true,
    });
    generateDebtGates(config);
    const content = readFileSync(join(dir, ".golangci.yml"), "utf-8");
    expect(content).toContain("gocyclo");
    expect(content).toContain("deadcode");
  });

  it("does not generate .golangci.yml for non-Go projects", () => {
    const config = makeConfig(dir, {
      language: "typescript",
      enableDebtGates: true,
    });
    generateDebtGates(config);
    expect(existsSync(join(dir, ".golangci.yml"))).toBe(false);
  });

  it("generates config/pmd-ruleset.xml for Java projects", () => {
    cleanupTestProject(dir);
    dir = createTestProject("java");
    const config = makeConfig(dir, {
      language: "java",
      buildTool: "gradle",
      enableDebtGates: true,
    });
    const result = generateDebtGates(config);
    expect(result.files.some((f) => f.path.endsWith("pmd-ruleset.xml"))).toBe(
      true,
    );
    expect(existsSync(join(dir, "config", "pmd-ruleset.xml"))).toBe(true);
  });

  it("pmd-ruleset.xml includes CyclomaticComplexity rule", () => {
    cleanupTestProject(dir);
    dir = createTestProject("java");
    const config = makeConfig(dir, {
      language: "java",
      buildTool: "gradle",
      enableDebtGates: true,
    });
    generateDebtGates(config);
    const content = readFileSync(
      join(dir, "config", "pmd-ruleset.xml"),
      "utf-8",
    );
    expect(content).toContain("CyclomaticComplexity");
  });

  it("does not generate pmd-ruleset.xml for non-Java projects", () => {
    const config = makeConfig(dir, {
      language: "typescript",
      enableDebtGates: true,
    });
    generateDebtGates(config);
    expect(existsSync(join(dir, "config", "pmd-ruleset.xml"))).toBe(false);
  });

  it("does not generate any config files for Rust projects", () => {
    cleanupTestProject(dir);
    dir = createTestProject("rust");
    const config = makeConfig(dir, {
      language: "rust",
      buildTool: "cargo",
      enableDebtGates: true,
    });
    const result = generateDebtGates(config);
    expect(result.files).toHaveLength(0);
  });

  it("does not generate any config files for Python projects", () => {
    cleanupTestProject(dir);
    dir = createTestProject("python");
    const config = makeConfig(dir, {
      language: "python",
      buildTool: "pip",
      enableDebtGates: true,
    });
    const result = generateDebtGates(config);
    expect(result.files).toHaveLength(0);
  });
});
