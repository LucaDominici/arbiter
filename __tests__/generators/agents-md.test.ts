import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateAgentsMd } from "../../src/generators/agents-md.js";
import { makeConfig } from "../helpers.js";

describe("generateAgentsMd", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-agents-md-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns a WriteResult with created action", () => {
    const result = generateAgentsMd(makeConfig(dir));
    expect(result.action).toBe("created");
    expect(result.path).toContain("AGENTS.md");
  });

  it("content contains the project name", () => {
    generateAgentsMd(makeConfig(dir, { projectName: "my-cool-project" }));
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(content).toContain("my-cool-project");
  });

  it("content contains governance level testing policy", () => {
    generateAgentsMd(makeConfig(dir, { governanceLevel: "L2" }));
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(content).toContain("L2 (Standard)");
    expect(content).toContain("80% coverage minimum");
  });

  it("content contains build and test commands", () => {
    generateAgentsMd(
      makeConfig(dir, {
        buildCommand: "npm run build",
        testCommand: "npm test",
      }),
    );
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(content).toContain("npm run build");
    expect(content).toContain("npm test");
  });

  it("content varies by language — TypeScript invariants", () => {
    generateAgentsMd(makeConfig(dir, { language: "typescript" }));
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(content).toContain("TypeScript");
    expect(content).toContain("No `any` type");
  });

  it("content varies by language — Java invariants", () => {
    generateAgentsMd(
      makeConfig(dir, { language: "java", buildTool: "gradle" }),
    );
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(content).toContain("Hexagonal architecture");
    expect(content).toContain("No raw types");
  });

  it("content varies by language — Rust invariants", () => {
    generateAgentsMd(makeConfig(dir, { language: "rust", buildTool: "cargo" }));
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(content).toContain("No `.unwrap()` calls");
  });
});
