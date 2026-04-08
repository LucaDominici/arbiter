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
});
