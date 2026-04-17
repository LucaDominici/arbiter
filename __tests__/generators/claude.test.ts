import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateClaude } from "../../src/generators/claude.js";
import { makeConfig } from "../helpers.js";

describe("generateClaude", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-claude-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("generates multiple files including CLAUDE.md", () => {
    const result = generateClaude(makeConfig(dir));
    expect(result.files.length).toBeGreaterThan(1);
    const claudeMd = result.files.find((f) => f.path.endsWith("CLAUDE.md"));
    expect(claudeMd).toBeDefined();
    expect(claudeMd!.action).toBe("created");
  });

  it("CLAUDE.md references AGENTS.md", () => {
    generateClaude(makeConfig(dir));
    const content = readFileSync(join(dir, ".claude", "CLAUDE.md"), "utf-8");
    expect(content).toContain("AGENTS.md");
  });

  it("settings.json is valid JSON with hooks", () => {
    generateClaude(makeConfig(dir));
    const raw = readFileSync(join(dir, ".claude", "settings.json"), "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed).toHaveProperty("hooks");
    expect(parsed).toHaveProperty("permissions");
  });

  it("hook scripts have shebang lines", () => {
    generateClaude(makeConfig(dir));
    const hookContent = readFileSync(
      join(dir, ".claude", "hooks", "stop-dangerous.mjs"),
      "utf-8",
    );
    expect(hookContent).toMatch(/^#!/);
  });

  it("generates rules, commands, and hooks directories", () => {
    generateClaude(makeConfig(dir));
    expect(
      existsSync(join(dir, ".claude", "rules", "90-exec-protocol.md")),
    ).toBe(true);
    expect(existsSync(join(dir, ".claude", "commands", "task.md"))).toBe(true);
    expect(existsSync(join(dir, ".claude", "hooks", "lib.mjs"))).toBe(true);
  });

  it("includes language hooks in settings.json when provided", () => {
    const config = makeConfig(dir, {
      languageHooks: [
        {
          name: "check-no-any.mjs",
          description: "Block any types",
          body: '#!/usr/bin/env bash\necho "checking any"',
        },
      ],
    });
    generateClaude(config);
    const raw = readFileSync(join(dir, ".claude", "settings.json"), "utf-8");
    expect(raw).toContain("check-no-any.mjs");
  });

  it("generates pre-compact.mjs and pre-edit-plan-anchor.mjs at L1", () => {
    const config = makeConfig(dir, { governanceLevel: "L1" });
    generateClaude(config);
    expect(existsSync(join(dir, ".claude", "hooks", "pre-compact.mjs"))).toBe(
      true,
    );
    expect(
      existsSync(join(dir, ".claude", "hooks", "pre-edit-plan-anchor.mjs")),
    ).toBe(true);
  });

  it("generates all 5 advanced hooks at L2", () => {
    const config = makeConfig(dir, { governanceLevel: "L2" });
    generateClaude(config);
    const hooksDir = join(dir, ".claude", "hooks");
    expect(existsSync(join(hooksDir, "pre-compact.mjs"))).toBe(true);
    expect(existsSync(join(hooksDir, "pre-edit-plan-anchor.mjs"))).toBe(true);
    expect(existsSync(join(hooksDir, "post-edit-dispatch.mjs"))).toBe(true);
    expect(existsSync(join(hooksDir, "debug-state-on-failure.mjs"))).toBe(true);
    expect(existsSync(join(hooksDir, "skill-forced-eval.mjs"))).toBe(true);
  });

  it("does NOT generate L2-only advanced hooks at L1", () => {
    const config = makeConfig(dir, { governanceLevel: "L1" });
    generateClaude(config);
    const hooksDir = join(dir, ".claude", "hooks");
    expect(existsSync(join(hooksDir, "post-edit-dispatch.mjs"))).toBe(false);
    expect(existsSync(join(hooksDir, "debug-state-on-failure.mjs"))).toBe(
      false,
    );
    expect(existsSync(join(hooksDir, "skill-forced-eval.mjs"))).toBe(false);
  });
});
