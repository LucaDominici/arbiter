import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateAider } from "../../src/generators/aider.js";
import { makeConfig } from "../helpers.js";

describe("generateAider", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-aider-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("generates .aider.conf.yml file", () => {
    const result = generateAider(makeConfig(dir));
    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toContain(".aider.conf.yml");
    expect(result.files[0].action).toBe("created");
  });

  it(".aider.conf.yml content references AGENTS.md", () => {
    generateAider(makeConfig(dir));
    const content = readFileSync(join(dir, ".aider.conf.yml"), "utf-8");
    expect(content).toContain("AGENTS.md");
  });

  it(".aider.conf.yml contains project stack info", () => {
    generateAider(
      makeConfig(dir, {
        projectName: "aider-proj",
        buildCommand: "cargo build",
        testCommand: "cargo test",
      }),
    );
    const content = readFileSync(join(dir, ".aider.conf.yml"), "utf-8");
    expect(content).toContain("aider-proj");
    expect(content).toContain("cargo build");
    expect(content).toContain("cargo test");
  });
});
