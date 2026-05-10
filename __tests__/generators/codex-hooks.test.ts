import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { generateCodexHooks } from "../../src/generators/codex-hooks.js";
import { makeConfig } from "../helpers.js";

describe("generateCodexHooks", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-codex-hooks-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("generates .codex/config.toml and .codex/codex-adapter.mjs", () => {
    const result = generateCodexHooks(makeConfig(dir));
    const paths = result.files.map((f) => f.path);
    expect(paths.some((p) => p.endsWith("config.toml"))).toBe(true);
    expect(paths.some((p) => p.endsWith("codex-adapter.mjs"))).toBe(true);
  });

  it("config.toml is syntactically valid TOML", () => {
    generateCodexHooks(makeConfig(dir));
    const content = readFileSync(join(dir, ".codex", "config.toml"), "utf-8");
    expect(() => parseToml(content)).not.toThrow();
  });

  it("config.toml enables codex_hooks feature", () => {
    generateCodexHooks(makeConfig(dir));
    const content = readFileSync(join(dir, ".codex", "config.toml"), "utf-8");
    const parsed = parseToml(content) as Record<string, unknown>;
    const features = parsed.features as Record<string, unknown>;
    expect(features?.codex_hooks).toBe(true);
  });

  it("config.toml wires stop-dangerous adapter for bash PreToolUse", () => {
    generateCodexHooks(makeConfig(dir));
    const content = readFileSync(join(dir, ".codex", "config.toml"), "utf-8");
    expect(content).toContain("stop-dangerous.mjs");
    expect(content).toContain("bash");
  });

  it("config.toml wires enforce-read-only and ssot-guard for apply_patch PreToolUse", () => {
    generateCodexHooks(makeConfig(dir));
    const content = readFileSync(join(dir, ".codex", "config.toml"), "utf-8");
    expect(content).toContain("enforce-read-only.mjs");
    expect(content).toContain("pre-edit-ssot-guard.mjs");
    expect(content).toContain("apply_patch");
  });

  it("config.toml wires check-no-orphan-todo for apply_patch PostToolUse", () => {
    generateCodexHooks(makeConfig(dir));
    const content = readFileSync(join(dir, ".codex", "config.toml"), "utf-8");
    expect(content).toContain("check-no-orphan-todo.mjs");
  });

  it("includes check-no-pii when enableSecurityScanning is true", () => {
    generateCodexHooks(makeConfig(dir, { governanceLevel: "L2" }));
    const content = readFileSync(join(dir, ".codex", "config.toml"), "utf-8");
    expect(content).toContain("check-no-pii.mjs");
  });

  it("omits check-no-pii when enableSecurityScanning is false (L1)", () => {
    generateCodexHooks(makeConfig(dir, { governanceLevel: "L1" }));
    const content = readFileSync(join(dir, ".codex", "config.toml"), "utf-8");
    expect(content).not.toContain("check-no-pii.mjs");
  });

  it("codex-adapter.mjs reads stdin and sets env vars", () => {
    generateCodexHooks(makeConfig(dir));
    const content = readFileSync(
      join(dir, ".codex", "codex-adapter.mjs"),
      "utf-8",
    );
    expect(content).toContain("CLAUDE_TOOL_INPUT_PATH");
    expect(content).toContain("CLAUDE_TOOL_INPUT_COMMAND");
    expect(content).toContain("apply_patch");
    expect(content).toContain("bash");
  });

  it("returns 'created' action for new files", () => {
    const result = generateCodexHooks(makeConfig(dir));
    const created = result.files.filter((f) => f.action === "created");
    expect(created.length).toBe(2);
  });

  it("skips adapter if already exists (skipIfExists)", () => {
    generateCodexHooks(makeConfig(dir));
    const result2 = generateCodexHooks(makeConfig(dir));
    const adapter = result2.files.find((f) =>
      f.path.endsWith("codex-adapter.mjs"),
    );
    expect(adapter?.action).toBe("skipped");
  });

  it("backs up and replaces config.toml on re-run", () => {
    generateCodexHooks(makeConfig(dir));
    const result2 = generateCodexHooks(makeConfig(dir));
    const toml = result2.files.find((f) => f.path.endsWith("config.toml"));
    expect(toml?.action).toBe("backed-up-and-replaced");
  });
});
