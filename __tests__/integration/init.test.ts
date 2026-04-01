import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { runInit } from "../../src/commands/init.js";

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "arbiter-init-test-"));
}

function initGit(dir: string): void {
  execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@test.com"], {
    cwd: dir,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.name", "Test"], {
    cwd: dir,
    stdio: "ignore",
  });
}

describe("arbiter init --yes", () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
    initGit(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("generates AGENTS.md on a fresh directory", async () => {
    await runInit({ yes: true, tools: "claude,codex", level: "L2", dir });
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(true);
  });

  it("AGENTS.md contains project name", async () => {
    await runInit({ yes: true, tools: "claude,codex", level: "L2", dir });
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(content.length).toBeGreaterThan(100);
    expect(content).toContain("AGENTS.md");
  });

  it("generates .claude/ directory with CLAUDE.md", async () => {
    await runInit({ yes: true, tools: "claude", level: "L2", dir });
    expect(existsSync(join(dir, ".claude", "CLAUDE.md"))).toBe(true);
  });

  it("CLAUDE.md is a thin pointer referencing AGENTS.md", async () => {
    await runInit({ yes: true, tools: "claude", level: "L2", dir });
    const content = readFileSync(join(dir, ".claude", "CLAUDE.md"), "utf-8");
    expect(content).toContain("AGENTS.md");
  });

  it("generates .claude/settings.json", async () => {
    await runInit({ yes: true, tools: "claude", level: "L2", dir });
    expect(existsSync(join(dir, ".claude", "settings.json"))).toBe(true);
    const settings = JSON.parse(
      readFileSync(join(dir, ".claude", "settings.json"), "utf-8"),
    ) as Record<string, unknown>;
    expect(settings).toHaveProperty("hooks");
  });

  it("generates .claude/hooks/ with hook scripts", async () => {
    await runInit({ yes: true, tools: "claude", level: "L2", dir });
    expect(
      existsSync(join(dir, ".claude", "hooks", "stop-dangerous.mjs")),
    ).toBe(true);
    expect(
      existsSync(join(dir, ".claude", "hooks", "enforce-read-only.mjs")),
    ).toBe(true);
  });

  it("generates .agents/ directory with CODEX.md", async () => {
    await runInit({ yes: true, tools: "codex", level: "L2", dir });
    expect(existsSync(join(dir, ".agents", "CODEX.md"))).toBe(true);
  });

  it("CODEX.md references AGENTS.md", async () => {
    await runInit({ yes: true, tools: "codex", level: "L2", dir });
    const content = readFileSync(join(dir, ".agents", "CODEX.md"), "utf-8");
    expect(content).toContain("AGENTS.md");
  });

  it("skips existing hooks files on re-run", async () => {
    await runInit({ yes: true, tools: "claude", level: "L2", dir });
    const hookPath = join(dir, ".claude", "hooks", "stop-dangerous.mjs");
    const original = readFileSync(hookPath, "utf-8");

    // Second run — hook must not be overwritten
    await runInit({ yes: true, tools: "claude", level: "L2", dir });
    const after = readFileSync(hookPath, "utf-8");
    expect(after).toBe(original);
  });

  it("generates with --level L1", async () => {
    await runInit({ yes: true, tools: "claude,codex", level: "L1", dir });
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(true);
  });
});
