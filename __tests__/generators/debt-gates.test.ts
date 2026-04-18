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

  // ── TypeScript ──────────────────────────────────────────────────────────────

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

  it("generates .eslintrc-static.json for TypeScript projects (M29)", () => {
    const config = makeConfig(dir, {
      language: "typescript",
      enableDebtGates: true,
    });
    const result = generateDebtGates(config);
    expect(
      result.files.some((f) => f.path.endsWith(".eslintrc-static.json")),
    ).toBe(true);
    expect(existsSync(join(dir, ".eslintrc-static.json"))).toBe(true);
  });

  it(".eslintrc-static.json contains valid JSON with max-params rule (M29)", () => {
    const config = makeConfig(dir, {
      language: "typescript",
      enableDebtGates: true,
    });
    generateDebtGates(config);
    const content = readFileSync(join(dir, ".eslintrc-static.json"), "utf-8");
    const parsed = JSON.parse(content) as Record<string, unknown>;
    expect(parsed).toHaveProperty("rules");
    const rules = parsed.rules as Record<string, unknown>;
    expect(rules).toHaveProperty("max-params");
  });

  it("generates .prettierrc.json for TypeScript projects (M29)", () => {
    const config = makeConfig(dir, {
      language: "typescript",
      enableDebtGates: true,
    });
    const result = generateDebtGates(config);
    expect(result.files.some((f) => f.path.endsWith(".prettierrc.json"))).toBe(
      true,
    );
    expect(existsSync(join(dir, ".prettierrc.json"))).toBe(true);
  });

  it(".prettierrc.json contains valid JSON with printWidth (M29)", () => {
    const config = makeConfig(dir, {
      language: "typescript",
      enableDebtGates: true,
    });
    generateDebtGates(config);
    const content = readFileSync(join(dir, ".prettierrc.json"), "utf-8");
    const parsed = JSON.parse(content) as Record<string, unknown>;
    expect(parsed).toHaveProperty("printWidth");
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

  // ── Go ─────────────────────────────────────────────────────────────────────

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

  it(".golangci.yml enables gocyclo, unused, and full suite (M29)", () => {
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
    expect(content).toContain("unused");
    expect(content).toContain("gosec");
    expect(content).toContain("errcheck");
    expect(content).toContain("staticcheck");
  });

  it("does not generate .golangci.yml for non-Go projects", () => {
    const config = makeConfig(dir, {
      language: "typescript",
      enableDebtGates: true,
    });
    generateDebtGates(config);
    expect(existsSync(join(dir, ".golangci.yml"))).toBe(false);
  });

  // ── Java ───────────────────────────────────────────────────────────────────

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

  it("pmd-ruleset.xml includes precise 7-category ruleset (M29)", () => {
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
    expect(content).toContain("security.xml");
    expect(content).toContain("multithreading.xml");
    expect(content).toContain("GodClass");
  });

  it("generates config/checkstyle.xml for Java projects (M29)", () => {
    cleanupTestProject(dir);
    dir = createTestProject("java");
    const config = makeConfig(dir, {
      language: "java",
      buildTool: "gradle",
      enableDebtGates: true,
    });
    const result = generateDebtGates(config);
    expect(result.files.some((f) => f.path.endsWith("checkstyle.xml"))).toBe(
      true,
    );
    expect(existsSync(join(dir, "config", "checkstyle.xml"))).toBe(true);
  });

  it("checkstyle.xml contains MethodLength(65) and ParameterNumber(7) (M29)", () => {
    cleanupTestProject(dir);
    dir = createTestProject("java");
    const config = makeConfig(dir, {
      language: "java",
      buildTool: "gradle",
      enableDebtGates: true,
    });
    generateDebtGates(config);
    const content = readFileSync(
      join(dir, "config", "checkstyle.xml"),
      "utf-8",
    );
    expect(content).toContain("MethodLength");
    expect(content).toContain("65");
    expect(content).toContain("ParameterNumber");
    expect(content).toContain("7");
  });

  it("generates config/spotbugs-exclude.xml for Java projects (M29)", () => {
    cleanupTestProject(dir);
    dir = createTestProject("java");
    const config = makeConfig(dir, {
      language: "java",
      buildTool: "gradle",
      enableDebtGates: true,
    });
    const result = generateDebtGates(config);
    expect(
      result.files.some((f) => f.path.endsWith("spotbugs-exclude.xml")),
    ).toBe(true);
    expect(existsSync(join(dir, "config", "spotbugs-exclude.xml"))).toBe(true);
  });

  it("spotbugs-exclude.xml suppresses framework FPs but NOT SQL_INJECTION (M29)", () => {
    cleanupTestProject(dir);
    dir = createTestProject("java");
    const config = makeConfig(dir, {
      language: "java",
      buildTool: "gradle",
      enableDebtGates: true,
    });
    generateDebtGates(config);
    const content = readFileSync(
      join(dir, "config", "spotbugs-exclude.xml"),
      "utf-8",
    );
    expect(content).toContain("NP_NONNULL_FIELD");
    expect(content).not.toContain("SQL_INJECTION");
  });

  it("generates spotless.gradle for Java projects (M29)", () => {
    cleanupTestProject(dir);
    dir = createTestProject("java");
    const config = makeConfig(dir, {
      language: "java",
      buildTool: "gradle",
      enableDebtGates: true,
    });
    const result = generateDebtGates(config);
    expect(result.files.some((f) => f.path.endsWith("spotless.gradle"))).toBe(
      true,
    );
    expect(existsSync(join(dir, "spotless.gradle"))).toBe(true);
  });

  it("spotless.gradle contains googleJavaFormat (M29)", () => {
    cleanupTestProject(dir);
    dir = createTestProject("java");
    const config = makeConfig(dir, {
      language: "java",
      buildTool: "gradle",
      enableDebtGates: true,
    });
    generateDebtGates(config);
    const content = readFileSync(join(dir, "spotless.gradle"), "utf-8");
    expect(content).toContain("googleJavaFormat");
  });

  it("generates spotbugs.gradle for Java projects (CANON-05)", () => {
    cleanupTestProject(dir);
    dir = createTestProject("java");
    const config = makeConfig(dir, {
      language: "java",
      buildTool: "gradle",
      enableDebtGates: true,
    });
    const result = generateDebtGates(config);
    expect(result.files.some((f) => f.path.endsWith("spotbugs.gradle"))).toBe(
      true,
    );
    expect(existsSync(join(dir, "spotbugs.gradle"))).toBe(true);
    const content = readFileSync(join(dir, "spotbugs.gradle"), "utf-8");
    expect(content).toContain("com.github.spotbugs");
    expect(content).toContain("excludeFilter");
  });

  it("does not generate pmd-ruleset.xml for non-Java projects", () => {
    const config = makeConfig(dir, {
      language: "typescript",
      enableDebtGates: true,
    });
    generateDebtGates(config);
    expect(existsSync(join(dir, "config", "pmd-ruleset.xml"))).toBe(false);
  });

  // ── Rust ───────────────────────────────────────────────────────────────────

  it("does not generate any debt-gate config files for Rust projects (clippy owned by boundaries)", () => {
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

  // ── Python ─────────────────────────────────────────────────────────────────

  it("generates ruff.toml for Python projects (M29)", () => {
    cleanupTestProject(dir);
    dir = createTestProject("python");
    const config = makeConfig(dir, {
      language: "python",
      buildTool: "pip",
      enableDebtGates: true,
    });
    const result = generateDebtGates(config);
    expect(result.files.some((f) => f.path.endsWith("ruff.toml"))).toBe(true);
    expect(existsSync(join(dir, "ruff.toml"))).toBe(true);
  });

  it("ruff.toml contains C901 and PLR0911 complexity rules (M29)", () => {
    cleanupTestProject(dir);
    dir = createTestProject("python");
    const config = makeConfig(dir, {
      language: "python",
      buildTool: "pip",
      enableDebtGates: true,
    });
    generateDebtGates(config);
    const content = readFileSync(join(dir, "ruff.toml"), "utf-8");
    expect(content).toContain("C901");
    expect(content).toContain("PLR0911");
  });

  it("ruff.toml extends boundaries for hexagonal Python projects (M29)", () => {
    cleanupTestProject(dir);
    dir = createTestProject("python");
    const config = makeConfig(dir, {
      language: "python",
      buildTool: "pip",
      enableDebtGates: true,
      architectureStyle: "hexagonal",
    });
    generateDebtGates(config);
    const content = readFileSync(join(dir, "ruff.toml"), "utf-8");
    expect(content).toContain("ruff-boundaries.toml");
  });

  // ── Pitest ─────────────────────────────────────────────────────────────────

  it("generates config/pitest-setup.md for Java L2+ projects", () => {
    cleanupTestProject(dir);
    dir = createTestProject("java");
    const config = makeConfig(dir, {
      language: "java",
      buildTool: "gradle",
      enableDebtGates: true,
      governanceLevel: "L2",
    });
    const result = generateDebtGates(config);
    expect(result.files.some((f) => f.path.endsWith("pitest-setup.md"))).toBe(
      true,
    );
    expect(existsSync(join(dir, "config", "pitest-setup.md"))).toBe(true);
  });

  it("pitest-setup.md contains both Maven and Gradle snippets", () => {
    cleanupTestProject(dir);
    dir = createTestProject("java");
    const config = makeConfig(dir, {
      language: "java",
      buildTool: "gradle",
      enableDebtGates: true,
      governanceLevel: "L2",
    });
    generateDebtGates(config);
    const content = readFileSync(
      join(dir, "config", "pitest-setup.md"),
      "utf-8",
    );
    expect(content).toContain("pitest");
    expect(content).toContain("Maven");
    expect(content).toContain("Gradle");
    expect(content).toContain("mutationThreshold");
  });

  it("does not generate pitest-setup.md for non-Java projects", () => {
    const config = makeConfig(dir, {
      language: "typescript",
      enableDebtGates: true,
    });
    generateDebtGates(config);
    expect(existsSync(join(dir, "config", "pitest-setup.md"))).toBe(false);
  });
});
