import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateCodex } from "../../src/generators/codex.js";
import { makeConfig } from "../helpers.js";

describe("generateCodex", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-codex-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("generates CODEX.md and rules", () => {
    const result = generateCodex(makeConfig(dir));
    expect(result.files.length).toBeGreaterThanOrEqual(2);
    const codexMd = result.files.find((f) => f.path.endsWith("CODEX.md"));
    expect(codexMd).toBeDefined();
    expect(codexMd!.action).toBe("created");
  });

  it("CODEX.md references AGENTS.md", () => {
    generateCodex(makeConfig(dir));
    const content = readFileSync(join(dir, ".agents", "CODEX.md"), "utf-8");
    expect(content).toContain("AGENTS.md");
  });

  it("creates rules directory with expected files", () => {
    generateCodex(makeConfig(dir));
    expect(
      existsSync(join(dir, ".agents", "rules", "05-agent-lifecycle.md")),
    ).toBe(true);
    expect(
      existsSync(join(dir, ".agents", "rules", "25-todo-folder-policy.md")),
    ).toBe(true);
    expect(
      existsSync(join(dir, ".agents", "rules", "90-exec-protocol.md")),
    ).toBe(true);
  });

  it("creates plan directory with README", () => {
    generateCodex(makeConfig(dir));
    expect(existsSync(join(dir, ".agents", "plan", "README.md"))).toBe(true);
    const content = readFileSync(
      join(dir, ".agents", "plan", "README.md"),
      "utf-8",
    );
    expect(content).toContain("PLAN.json");
  });
});
