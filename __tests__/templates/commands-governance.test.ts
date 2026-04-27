import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/utils/render.js";
import { makeConfig } from "../helpers.js";
import type { GovernanceLevel } from "../../src/wizard/types.js";

/**
 * M11: Workflow commands — governance level affects command content.
 *
 * L1: minimal workflow (branch, plan, implement, gate, commit, PR)
 * L2: full workflow (L1 + tier classification, code review agents, verifier, cleanup)
 * L3: full workflow (L2 + verification criteria, SSOT updates)
 *
 * INV-11: All governance levels tested.
 */

function renderTaskForLevel(level: GovernanceLevel): string {
  const config = makeConfig("/tmp/test", { governanceLevel: level });
  return renderTemplate(
    "claude/commands/task.md.ejs",
    config as unknown as Record<string, unknown>,
  );
}

describe("claude commands — governance level L1", () => {
  it("has basic structure (branch + issue + plan)", () => {
    const content = renderTaskForLevel("L1");
    expect(content).toMatch(/branch/i);
    expect(content).toMatch(/issue/i);
  });

  it("has gate section", () => {
    const content = renderTaskForLevel("L1");
    expect(content).toMatch(/gate|Gate/i);
  });

  // Negative assertions: L1 must NOT include L2/L3 features
  it("does NOT contain tier classification (XS/Standard)", () => {
    const content = renderTaskForLevel("L1");
    expect(content).not.toMatch(/\bXS\b/);
    expect(content).not.toMatch(/\bStandard\b/);
  });

  it("does NOT contain code review agent dispatch", () => {
    const content = renderTaskForLevel("L1");
    expect(content).not.toMatch(/agent.*dispatch|dispatch.*agent/i);
  });

  it("does NOT contain adversarial verifier", () => {
    const content = renderTaskForLevel("L1");
    expect(content).not.toMatch(/Adversarial Verifier/);
  });

  it("does NOT contain worktree recommendation", () => {
    const content = renderTaskForLevel("L1");
    expect(content).not.toMatch(/wt-open/);
  });

  it("does NOT contain cleanup phase", () => {
    const content = renderTaskForLevel("L1");
    expect(content).not.toMatch(/\bCleanup\b/);
  });

  it("does NOT contain state file writes", () => {
    const content = renderTaskForLevel("L1");
    expect(content).not.toMatch(/\.task-id/);
    expect(content).not.toMatch(/\.task-phase/);
  });

  it("does NOT contain verification criteria", () => {
    const content = renderTaskForLevel("L1");
    expect(content).not.toMatch(/Verification criteria/i);
  });
});

describe("claude commands — governance level L2", () => {
  it("includes tier classification", () => {
    const content = renderTaskForLevel("L2");
    expect(content).toMatch(/XS|Standard/);
  });

  it("includes code review agent dispatch", () => {
    const content = renderTaskForLevel("L2");
    expect(content).toMatch(/agents-dispatched/);
  });

  it("includes adversarial verifier", () => {
    const content = renderTaskForLevel("L2");
    expect(content).toMatch(/Adversarial Verifier/);
  });

  it("includes worktree recommendation", () => {
    const content = renderTaskForLevel("L2");
    expect(content).toMatch(/wt-open/);
  });

  it("includes cleanup phase", () => {
    const content = renderTaskForLevel("L2");
    expect(content).toMatch(/\bCleanup\b/);
  });

  it("includes state file writes", () => {
    const content = renderTaskForLevel("L2");
    expect(content).toMatch(/\.task-id/);
    expect(content).toMatch(/\.task-phase/);
  });

  it("does NOT contain verification criteria (L3 only)", () => {
    const content = renderTaskForLevel("L2");
    expect(content).not.toMatch(/Verification criteria/i);
  });
});

describe("claude commands — governance level L3", () => {
  it("includes verification criteria", () => {
    const content = renderTaskForLevel("L3");
    expect(content).toMatch(/Verification criteria/i);
  });

  it("includes SSOT updates section", () => {
    const content = renderTaskForLevel("L3");
    expect(content).toMatch(/SSOT updates/i);
  });

  it("includes all L2 features", () => {
    const content = renderTaskForLevel("L3");
    expect(content).toMatch(/agents-dispatched/);
    expect(content).toMatch(/wt-open/);
    expect(content).toMatch(/\.task-id/);
  });
});
