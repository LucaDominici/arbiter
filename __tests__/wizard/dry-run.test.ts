import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createTestProject, initGit, cleanupTestProject } from "../helpers.js";
import { runInit } from "../../src/commands/init.js";

describe("arbiter init --dry-run", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestProject("typescript");
    initGit(dir);
  });

  afterEach(() => {
    cleanupTestProject(dir);
  });

  it("does not create any files in dry-run mode", async () => {
    await runInit({
      yes: true,
      tools: "claude",
      level: "L2",
      dir,
      dryRun: true,
    });

    expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(dir, ".claude"))).toBe(false);
    expect(existsSync(join(dir, "arbiter.json"))).toBe(false);
  });

  it("does not save arbiter.json in dry-run mode", async () => {
    await runInit({
      yes: true,
      tools: "claude,codex",
      level: "L1",
      dir,
      dryRun: true,
    });

    expect(existsSync(join(dir, "arbiter.json"))).toBe(false);
  });

  it("creates files normally when dry-run is false", async () => {
    await runInit({
      yes: true,
      tools: "claude",
      level: "L2",
      dir,
      dryRun: false,
    });

    expect(existsSync(join(dir, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(dir, ".claude"))).toBe(true);
    expect(existsSync(join(dir, "arbiter.json"))).toBe(true);
  });
});
