import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/utils/render.js";
import { makeConfig } from "../helpers.js";
import { DEFAULT_TASK_TIERS } from "../../src/config/schema.js";

function render(taskTiers?: unknown): string {
  const config = makeConfig("/tmp/test", {
    governanceLevel: "L2",
    testCommand: "npm test",
  });
  const data = {
    ...(config as unknown as Record<string, unknown>),
    taskTiers,
  };
  return renderTemplate("claude/commands/task.md.ejs", data);
}

describe("task.md.ejs taskTiers rendering (#237)", () => {
  it("renders default tier guidance when taskTiers is undefined", () => {
    const out = render(undefined);
    // Default falls back to canonical XS:3, S:3, Standard:4
    expect(out).toMatch(/Tier XS[\s\S]*?3 review agents/);
    expect(out).toMatch(/Tier Standard[\s\S]*?4 review agents/);
  });

  it("renders three distinct tier blocks", () => {
    const out = render(DEFAULT_TASK_TIERS);
    // Headers for each tier
    expect(out).toContain("### Tier XS");
    expect(out).toContain("### Tier S");
    expect(out).toContain("### Tier Standard");
    // Plan depth qualifiers per tier
    expect(out).toMatch(/Tier XS[\s\S]*?Plan depth.*minimal/);
    expect(out).toMatch(/Tier S[\s\S]*?Plan depth.*brief/);
    expect(out).toMatch(/Tier Standard[\s\S]*?Plan depth.*full/);
  });

  it("renders custom reviewAgentCount per tier", () => {
    const custom = {
      XS: { planDepth: "minimal", reviewAgentCount: 2 },
      S: { planDepth: "brief", reviewAgentCount: 5 },
      Standard: { planDepth: "full", reviewAgentCount: 6 },
    };
    const out = render(custom);
    expect(out).toMatch(/Tier XS[\s\S]*?2 review agents/);
    expect(out).toMatch(/Tier S[\s\S]*?5 review agents/);
    expect(out).toMatch(/Tier Standard[\s\S]*?6 review agents/);
  });
});
