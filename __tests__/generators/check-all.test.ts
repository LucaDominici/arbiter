import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateCheckAll } from "../../src/generators/check-all.js";
import { makeConfig } from "../helpers.js";

describe("generateCheckAll", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-check-all-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("generates scripts/check-all.mjs", () => {
    const result = generateCheckAll(makeConfig(dir));
    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toContain("check-all.mjs");
    expect(result.files[0].action).toBe("created");
  });

  it("check-all.mjs has shebang line", () => {
    generateCheckAll(makeConfig(dir));
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(content).toMatch(/^#!/);
  });

  it("check-all.mjs contains lint and test commands for TypeScript", () => {
    generateCheckAll(makeConfig(dir, { language: "typescript" }));
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(content).toContain("eslint");
    expect(content).toContain("npm");
    expect(content).toContain("prettier");
  });

  it("check-all.mjs contains Rust commands for Rust projects", () => {
    generateCheckAll(makeConfig(dir, { language: "rust", buildTool: "cargo" }));
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(content).toContain("fmt");
    expect(content).toContain("clippy");
    expect(content).toContain("cargo");
  });

  it("skips if check-all.mjs already exists", () => {
    const scriptsDir = join(dir, "scripts");
    mkdirSync(scriptsDir, { recursive: true });
    writeFileSync(join(scriptsDir, "check-all.mjs"), "EXISTING");

    const result = generateCheckAll(makeConfig(dir));
    expect(result.files[0].action).toBe("skipped");
    expect(readFileSync(join(scriptsDir, "check-all.mjs"), "utf-8")).toBe(
      "EXISTING",
    );
  });

  it("includes debt ratchet gate at L2 when enableDebtGates is true", () => {
    generateCheckAll(
      makeConfig(dir, { enableDebtGates: true, governanceLevel: "L2" }),
    );
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(content).toContain("debt-report.mjs");
    expect(content).toContain("--gate");
  });

  it("uses --require-improvement flag at L3", () => {
    generateCheckAll(
      makeConfig(dir, { enableDebtGates: true, governanceLevel: "L3" }),
    );
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(content).toContain("--require-improvement");
  });

  it("does not include debt ratchet when enableDebtGates is false", () => {
    generateCheckAll(makeConfig(dir, { enableDebtGates: false }));
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(content).not.toContain("debt-report.mjs");
  });

  it("includes pitest mutation check for Java + Gradle at L2", () => {
    generateCheckAll(
      makeConfig(dir, {
        language: "java",
        buildTool: "gradle",
        enableDebtGates: true,
        governanceLevel: "L2",
      }),
    );
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(content).toContain("pitest");
    expect(content).toContain("mutation testing");
  });

  it("includes pitest mutation check for Java + Maven at L2", () => {
    generateCheckAll(
      makeConfig(dir, {
        language: "java",
        buildTool: "maven",
        enableDebtGates: true,
        governanceLevel: "L2",
      }),
    );
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(content).toContain("pitest");
    expect(content).toContain("mutation testing");
  });

  it("does not include pitest for Java at L1 (no debt gates)", () => {
    generateCheckAll(
      makeConfig(dir, {
        language: "java",
        buildTool: "gradle",
        enableDebtGates: false,
        governanceLevel: "L1",
      }),
    );
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(content).not.toContain("pitest");
  });

  it("does not include pitest for non-Java languages at L2", () => {
    for (const lang of ["typescript", "rust", "go", "python"] as const) {
      generateCheckAll(
        makeConfig(dir, {
          language: lang,
          enableDebtGates: true,
          governanceLevel: "L2",
        }),
      );
      const content = readFileSync(
        join(dir, "scripts", "check-all.mjs"),
        "utf-8",
      );
      expect(content).not.toContain("pitest");
    }
  });

  it("includes STRIDE/RACI traceability check at L2 when enableDebtGates is true", () => {
    generateCheckAll(
      makeConfig(dir, { enableDebtGates: true, governanceLevel: "L2" }),
    );
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(content).toContain("check-stride-traceability.mjs");
    expect(content).toContain("STRIDE");
  });

  it("does not include STRIDE check outside L2 block (appears only within if-level check)", () => {
    generateCheckAll(makeConfig(dir, { enableDebtGates: true }));
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    // The check appears inside the `if (level === 'L2')` block — verify that
    const l2BlockStart = content.indexOf("if (level === 'L2')");
    const strideIdx = content.indexOf("check-stride-traceability.mjs");
    expect(l2BlockStart).toBeGreaterThan(-1);
    expect(strideIdx).toBeGreaterThan(l2BlockStart);
  });

  // ─── MG: scaled thresholds ──────────────────────────────────────────────────

  it("fixed profile (default) uses 80% coverage threshold at L2", () => {
    generateCheckAll(
      makeConfig(dir, {
        language: "typescript",
        enableDebtGates: true,
        governanceLevel: "L2",
        thresholdProfile: "fixed",
        linesOfCode: 500,
      }),
    );
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(content).toContain("80");
    expect(content).toContain("coverage");
  });

  it("scaled profile + LoC<1000 omits coverage gate from generated script", () => {
    generateCheckAll(
      makeConfig(dir, {
        language: "typescript",
        enableDebtGates: true,
        governanceLevel: "L2",
        thresholdProfile: "scaled",
        linesOfCode: 500,
      }),
    );
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(content).not.toContain("coverage.thresholds.lines");
  });

  it("scaled profile + LoC>=1000 includes coverage gate with ramped threshold", () => {
    generateCheckAll(
      makeConfig(dir, {
        language: "typescript",
        enableDebtGates: true,
        governanceLevel: "L2",
        thresholdProfile: "scaled",
        linesOfCode: 5000,
      }),
    );
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(content).toContain("coverage.thresholds.lines");
    // Threshold between 60% and 85% for 5k LoC
    expect(content).toMatch(/coverage\.thresholds\.lines=\d{2}/);
  });

  it("scaled profile + LoC>=10000 uses 85% coverage threshold", () => {
    generateCheckAll(
      makeConfig(dir, {
        language: "typescript",
        enableDebtGates: true,
        governanceLevel: "L2",
        thresholdProfile: "scaled",
        linesOfCode: 15_000,
      }),
    );
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(content).toContain("coverage.thresholds.lines=85");
  });
});
