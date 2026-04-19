import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateWindsurf } from "../../src/generators/windsurf.js";
import { makeConfig } from "../helpers.js";

describe("generateWindsurf", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-windsurf-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("generates windsurf-instructions.md file", () => {
    const result = generateWindsurf(makeConfig(dir));
    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toContain("windsurf-instructions.md");
    expect(result.files[0].action).toBe("created");
  });

  it("windsurf-instructions.md content references AGENTS.md", () => {
    generateWindsurf(makeConfig(dir));
    const content = readFileSync(
      join(dir, "windsurf-instructions.md"),
      "utf-8",
    );
    expect(content).toContain("AGENTS.md");
  });

  it("windsurf-instructions.md contains project stack info", () => {
    generateWindsurf(
      makeConfig(dir, {
        projectName: "windsurf-proj",
        buildCommand: "npm run build",
        testCommand: "npm test",
      }),
    );
    const content = readFileSync(
      join(dir, "windsurf-instructions.md"),
      "utf-8",
    );
    expect(content).toContain("windsurf-proj");
    expect(content).toContain("npm run build");
    expect(content).toContain("npm test");
  });
});
