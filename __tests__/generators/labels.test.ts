import { describe, it, expect } from "vitest";
import { generateLabelCommands } from "../../src/generators/labels.js";

describe("generateLabelCommands (#237)", () => {
  it("emits gh label create for each task tier", () => {
    const cmds = generateLabelCommands();
    expect(cmds.length).toBeGreaterThanOrEqual(3);
    const joined = cmds.join("\n");
    expect(joined).toMatch(/gh label create.*size:XS/);
    expect(joined).toMatch(/gh label create.*size:S\b/);
    expect(joined).toMatch(/gh label create.*size:Standard/);
  });

  it("each command sets a color and description", () => {
    const cmds = generateLabelCommands();
    for (const cmd of cmds) {
      expect(cmd).toMatch(/--color/);
      expect(cmd).toMatch(/--description/);
    }
  });

  it("uses --force flag so repeated init is idempotent", () => {
    const cmds = generateLabelCommands();
    for (const cmd of cmds) {
      expect(cmd).toContain("--force");
    }
  });
});
