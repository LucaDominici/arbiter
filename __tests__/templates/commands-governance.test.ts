import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/utils/render.js";
import { makeConfig } from "../helpers.js";
import type { GovernanceLevel } from "../../src/wizard/types.js";

/**
 * M11: Workflow commands — governance level affects command content.
 *
 * L1: minimal workflow (basic gate reference)
 * L2: standard workflow (plan gate, tier classification, TDD reference)
 * L3: full workflow (L2 + verification step, evidence)
 *
 * INV-11: All governance levels tested.
 */

function renderStartTaskForLevel(level: GovernanceLevel): string {
  const config = makeConfig("/tmp/test", { governanceLevel: level });
  return renderTemplate(
    "claude/commands/start-task.md.ejs",
    config as unknown as Record<string, unknown>,
  );
}

function renderCompleteTaskForLevel(level: GovernanceLevel): string {
  const config = makeConfig("/tmp/test", { governanceLevel: level });
  return renderTemplate(
    "claude/commands/complete-task.md.ejs",
    config as unknown as Record<string, unknown>,
  );
}

describe("claude commands — governance level L1", () => {
  it("start-task has basic structure (branch + issue + plan)", () => {
    const content = renderStartTaskForLevel("L1");
    expect(content).toMatch(/branch/i);
    expect(content).toMatch(/issue/i);
  });

  it("complete-task references L1 gate", () => {
    const content = renderCompleteTaskForLevel("L1");
    expect(content).toMatch(/L1/);
  });

  // Negative assertions: L1 must NOT include L2/L3 features
  it("start-task does NOT contain tier classification (XS/Standard)", () => {
    const content = renderStartTaskForLevel("L1");
    expect(content).not.toMatch(/\bXS\b/);
    expect(content).not.toMatch(/\bStandard\b/);
  });

  it("start-task does NOT contain TDD reference", () => {
    const content = renderStartTaskForLevel("L1");
    expect(content).not.toMatch(/\bTDD\b/);
    expect(content).not.toMatch(/Red.*Green/i);
  });

  it("start-task does NOT contain STOP HERE", () => {
    const content = renderStartTaskForLevel("L1");
    expect(content).not.toMatch(/STOP HERE/);
  });

  it("complete-task does NOT contain verification step", () => {
    const content = renderCompleteTaskForLevel("L1");
    expect(content).not.toMatch(/Verification/);
    expect(content).not.toMatch(/evidence/i);
  });
});

describe("claude commands — governance level L2", () => {
  it("start-task includes tier classification", () => {
    const content = renderStartTaskForLevel("L2");
    expect(content).toMatch(/XS|Standard/);
  });

  it("start-task includes TDD reference", () => {
    const content = renderStartTaskForLevel("L2");
    expect(content).toMatch(/TDD|test.driven|red.*green/i);
  });

  it("complete-task references L2 gate", () => {
    const content = renderCompleteTaskForLevel("L2");
    expect(content).toMatch(/L2/);
  });
});

describe("claude commands — governance level L3", () => {
  it("start-task includes verification step", () => {
    const content = renderStartTaskForLevel("L3");
    expect(content).toMatch(/verif|evidence/i);
  });

  it("complete-task includes verification before merge", () => {
    const content = renderCompleteTaskForLevel("L3");
    expect(content).toMatch(/verif|evidence/i);
  });

  it("complete-task references L3 gate (includes L2)", () => {
    const content = renderCompleteTaskForLevel("L3");
    expect(content).toMatch(/L3|L2/);
  });
});
