import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateSelfValidation } from "../../src/generators/self-validation.js";
import { makeConfig } from "../helpers.js";

describe("generateSelfValidation", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-sv-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("emits all three gate scripts", () => {
    const result = generateSelfValidation(makeConfig(dir));
    expect(result.files).toHaveLength(3);
    const paths = result.files.map((f) => f.path);
    expect(paths.some((p) => p.includes("self-validation.mjs"))).toBe(true);
    expect(paths.some((p) => p.includes("check-exit-code-contract.mjs"))).toBe(
      true,
    );
    expect(paths.some((p) => p.includes("check-pipe-tee-hazard.mjs"))).toBe(
      true,
    );
    expect(result.files.every((f) => f.action === "created")).toBe(true);
  });

  it("emitted script has a shebang line", () => {
    generateSelfValidation(makeConfig(dir));
    const content = readFileSync(
      join(dir, "scripts", "self-validation.mjs"),
      "utf-8",
    );
    expect(content).toMatch(/^#!/);
  });

  it("emitted script contains A/B/C drill output markers", () => {
    generateSelfValidation(makeConfig(dir));
    const content = readFileSync(
      join(dir, "scripts", "self-validation.mjs"),
      "utf-8",
    );
    expect(content).toContain("DRILL");
    expect(content).toContain("clean");
    expect(content).toContain("drift");
  });

  it("is idempotent (skipIfExists on second call — all three files)", () => {
    generateSelfValidation(makeConfig(dir));
    const result2 = generateSelfValidation(makeConfig(dir));
    expect(result2.files.every((f) => f.action === "skipped")).toBe(true);
  });

  it("emitted script encodes correct A/B/C exit expectations", () => {
    generateSelfValidation(makeConfig(dir));
    const content = readFileSync(
      join(dir, "scripts", "self-validation.mjs"),
      "utf-8",
    );
    expect(content).toContain("exit-code-contract");
    expect(content).toContain("pipe-tee-hazard");
    // exit-code-contract C expects exit 2 (gates must distinguish bad args from pass)
    expect(content).toContain("expectC: 2");
    // advisory pipe-tee-hazard exits 0 always — B also expects 0
    expect(content).toMatch(/pipe-tee-hazard[\s\S]{0,400}expectB:\s*0/);
  });
});
