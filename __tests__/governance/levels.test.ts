import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateAgentsMd } from "../../src/generators/agents-md.js";
import { generateCheckAll } from "../../src/generators/check-all.js";
import { makeConfig } from "../helpers.js";
import type { GovernanceLevel } from "../../src/wizard/types.js";

describe("governance levels", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-governance-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("AGENTS.md with L1 contains 70% coverage target", () => {
    generateAgentsMd(makeConfig(dir, { governanceLevel: "L1" }));
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(content).toContain("70%");
    expect(content).toContain("L1 (Minimal)");
  });

  it("AGENTS.md with L2 contains 80% coverage minimum", () => {
    generateAgentsMd(makeConfig(dir, { governanceLevel: "L2" }));
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(content).toContain("80% coverage minimum");
    expect(content).toContain("L2 (Standard)");
  });

  it("AGENTS.md with L3 contains 85% coverage and evidence requirements", () => {
    generateAgentsMd(makeConfig(dir, { governanceLevel: "L3" }));
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(content).toContain("85% coverage minimum");
    expect(content).toContain("Evidence artifacts");
    expect(content).toContain("L3 (Full Audit)");
  });

  it("L3 has additional invariants not present in L1", () => {
    // Generate L1
    const dirL1 = mkdtempSync(join(tmpdir(), "arbiter-gov-l1-"));
    generateAgentsMd(makeConfig(dirL1, { governanceLevel: "L1" }));
    const contentL1 = readFileSync(join(dirL1, "AGENTS.md"), "utf-8");

    // Generate L3
    const dirL3 = mkdtempSync(join(tmpdir(), "arbiter-gov-l3-"));
    generateAgentsMd(makeConfig(dirL3, { governanceLevel: "L3" }));
    const contentL3 = readFileSync(join(dirL3, "AGENTS.md"), "utf-8");

    // L3 has SSOT drift check — L1 does not
    expect(contentL3).toContain("SSOT documents must not contradict");
    expect(contentL1).not.toContain("SSOT documents must not contradict");

    // Cleanup extra dirs
    rmSync(dirL1, { recursive: true, force: true });
    rmSync(dirL3, { recursive: true, force: true });
  });

  it("check-all.mjs contains project name for all levels", () => {
    const levels: GovernanceLevel[] = ["L1", "L2", "L3"];
    for (const level of levels) {
      const levelDir = mkdtempSync(
        join(tmpdir(), `arbiter-gov-checkall-${level}-`),
      );
      generateCheckAll(
        makeConfig(levelDir, {
          governanceLevel: level,
          projectName: `proj-${level}`,
        }),
      );
      const content = readFileSync(
        join(levelDir, "scripts", "check-all.mjs"),
        "utf-8",
      );
      expect(content).toContain(`proj-${level}`);
      rmSync(levelDir, { recursive: true, force: true });
    }
  });
});
