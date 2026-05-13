import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createTestProject,
  initGit,
  cleanupTestProject,
  makeConfig,
} from "../helpers.js";
import { generateCoverage } from "../../src/generators/coverage.js";

describe("generateCoverage", () => {
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
    const result = generateCoverage(config);
    expect(result.files).toHaveLength(0);
  });

  // ── TypeScript ──────────────────────────────────────────────────────────────

  it("generates vitest.config.ts for TypeScript projects", () => {
    const config = makeConfig(dir, {
      language: "typescript",
      enableDebtGates: true,
    });
    const result = generateCoverage(config);
    expect(result.files.some((f) => f.path.endsWith("vitest.config.ts"))).toBe(
      true,
    );
    expect(existsSync(join(dir, "vitest.config.ts"))).toBe(true);
  });

  it("vitest.config.ts contains coverage provider and reporters", () => {
    const config = makeConfig(dir, {
      language: "typescript",
      enableDebtGates: true,
    });
    generateCoverage(config);
    const content = readFileSync(join(dir, "vitest.config.ts"), "utf-8");
    expect(content).toContain("v8");
    expect(content).toContain("html");
    expect(content).toContain("lcov");
  });

  it("vitest.config.ts contains include: ['src/**'] to scope coverage to source files", () => {
    const config = makeConfig(dir, {
      language: "typescript",
      enableDebtGates: true,
    });
    generateCoverage(config);
    const content = readFileSync(join(dir, "vitest.config.ts"), "utf-8");
    expect(content).toContain("include: ['src/**']");
  });

  // ── Java ───────────────────────────────────────────────────────────────────

  it("generates gradle/jacoco.gradle for Java Gradle projects", () => {
    const javaDir = createTestProject("java");
    initGit(javaDir);
    const config = makeConfig(javaDir, {
      language: "java",
      buildTool: "gradle",
      enableDebtGates: true,
    });
    const result = generateCoverage(config);
    expect(result.files.some((f) => f.path.endsWith("jacoco.gradle"))).toBe(
      true,
    );
    expect(existsSync(join(javaDir, "gradle", "jacoco.gradle"))).toBe(true);
    cleanupTestProject(javaDir);
  });

  it("generates docs/coverage/jacoco-maven-setup.md for Java Maven projects", () => {
    const javaDir = createTestProject("java");
    initGit(javaDir);
    const config = makeConfig(javaDir, {
      language: "java",
      buildTool: "maven",
      enableDebtGates: true,
    });
    const result = generateCoverage(config);
    expect(
      result.files.some((f) => f.path.endsWith("jacoco-maven-setup.md")),
    ).toBe(true);
    expect(
      existsSync(join(javaDir, "docs", "coverage", "jacoco-maven-setup.md")),
    ).toBe(true);
    cleanupTestProject(javaDir);
  });

  // ── Rust ───────────────────────────────────────────────────────────────────

  it("generates .tarpaulin.toml for Rust projects", () => {
    const rustDir = createTestProject("rust");
    initGit(rustDir);
    const config = makeConfig(rustDir, {
      language: "rust",
      buildTool: "cargo",
      enableDebtGates: true,
    });
    const result = generateCoverage(config);
    expect(result.files.some((f) => f.path.endsWith(".tarpaulin.toml"))).toBe(
      true,
    );
    expect(existsSync(join(rustDir, ".tarpaulin.toml"))).toBe(true);
    cleanupTestProject(rustDir);
  });

  // ── Python ─────────────────────────────────────────────────────────────────

  it("generates .coveragerc for Python projects", () => {
    const pyDir = createTestProject("python");
    initGit(pyDir);
    const config = makeConfig(pyDir, {
      language: "python",
      buildTool: "pip",
      enableDebtGates: true,
    });
    const result = generateCoverage(config);
    expect(result.files.some((f) => f.path.endsWith(".coveragerc"))).toBe(true);
    expect(existsSync(join(pyDir, ".coveragerc"))).toBe(true);
    cleanupTestProject(pyDir);
  });

  // ── Go ─────────────────────────────────────────────────────────────────────

  it("returns no config file for Go projects (gate script handles inline)", () => {
    const goDir = createTestProject("go");
    initGit(goDir);
    const config = makeConfig(goDir, {
      language: "go",
      buildTool: "go",
      enableDebtGates: true,
    });
    const result = generateCoverage(config);
    expect(result.files).toHaveLength(0);
    cleanupTestProject(goDir);
  });

  // ── Multi (Java+TS monorepo) ────────────────────────────────────────────────

  it("generates both vitest.config.ts and jacoco.gradle for multi projects", () => {
    const multiDir = createTestProject("multi");
    initGit(multiDir);
    const config = makeConfig(multiDir, {
      language: "multi",
      buildTool: "gradle",
      enableDebtGates: true,
    });
    const result = generateCoverage(config);
    expect(result.files.some((f) => f.path.endsWith("vitest.config.ts"))).toBe(
      true,
    );
    expect(result.files.some((f) => f.path.endsWith("jacoco.gradle"))).toBe(
      true,
    );
    expect(existsSync(join(multiDir, "vitest.config.ts"))).toBe(true);
    expect(existsSync(join(multiDir, "gradle", "jacoco.gradle"))).toBe(true);
    cleanupTestProject(multiDir);
  });
});
