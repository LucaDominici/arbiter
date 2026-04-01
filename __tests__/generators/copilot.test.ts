import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateCopilot } from "../../src/generators/copilot.js";
import { makeConfig } from "../helpers.js";

describe("generateCopilot", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-copilot-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("generates copilot-instructions.md", () => {
    const result = generateCopilot(makeConfig(dir));
    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toContain("copilot-instructions.md");
    expect(result.files[0].action).toBe("created");
  });

  it("copilot-instructions.md references AGENTS.md", () => {
    generateCopilot(makeConfig(dir));
    const content = readFileSync(
      join(dir, ".github", "copilot-instructions.md"),
      "utf-8",
    );
    expect(content).toContain("AGENTS.md");
  });

  it("copilot-instructions.md contains project context", () => {
    generateCopilot(
      makeConfig(dir, {
        projectName: "copilot-proj",
        lintCommand: "npm run lint",
      }),
    );
    const content = readFileSync(
      join(dir, ".github", "copilot-instructions.md"),
      "utf-8",
    );
    expect(content).toContain("copilot-proj");
    expect(content).toContain("npm run lint");
  });
});
