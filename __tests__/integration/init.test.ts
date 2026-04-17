import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { runInit, runGenerators } from "../../src/commands/init.js";
import { runProbes } from "../../src/compatibility/probe.js";
import { makeConfig } from "../helpers.js";

vi.mock("../../src/compatibility/probe.js", () => ({
  runProbes: vi.fn(),
}));

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
    await runInit({
      yes: true,
      tools: "claude,codex",
      level: "L2",
      dir,
      noVerify: true,
    });
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(true);
  });

  it("AGENTS.md contains project name", async () => {
    await runInit({
      yes: true,
      tools: "claude,codex",
      level: "L2",
      dir,
      noVerify: true,
    });
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(content.length).toBeGreaterThan(100);
    expect(content).toContain("AGENTS.md");
  });

  it("generates .claude/ directory with CLAUDE.md", async () => {
    await runInit({
      yes: true,
      tools: "claude",
      level: "L2",
      dir,
      noVerify: true,
    });
    expect(existsSync(join(dir, ".claude", "CLAUDE.md"))).toBe(true);
  });

  it("CLAUDE.md is a thin pointer referencing AGENTS.md", async () => {
    await runInit({
      yes: true,
      tools: "claude",
      level: "L2",
      dir,
      noVerify: true,
    });
    const content = readFileSync(join(dir, ".claude", "CLAUDE.md"), "utf-8");
    expect(content).toContain("AGENTS.md");
  });

  it("generates .claude/settings.json", async () => {
    await runInit({
      yes: true,
      tools: "claude",
      level: "L2",
      dir,
      noVerify: true,
    });
    expect(existsSync(join(dir, ".claude", "settings.json"))).toBe(true);
    const settings = JSON.parse(
      readFileSync(join(dir, ".claude", "settings.json"), "utf-8"),
    ) as Record<string, unknown>;
    expect(settings).toHaveProperty("hooks");
  });

  it("generates .claude/hooks/ with hook scripts", async () => {
    await runInit({
      yes: true,
      tools: "claude",
      level: "L2",
      dir,
      noVerify: true,
    });
    expect(
      existsSync(join(dir, ".claude", "hooks", "stop-dangerous.mjs")),
    ).toBe(true);
    expect(
      existsSync(join(dir, ".claude", "hooks", "enforce-read-only.mjs")),
    ).toBe(true);
  });

  it("generates .agents/ directory with CODEX.md", async () => {
    await runInit({
      yes: true,
      tools: "codex",
      level: "L2",
      dir,
      noVerify: true,
    });
    expect(existsSync(join(dir, ".agents", "CODEX.md"))).toBe(true);
  });

  it("CODEX.md references AGENTS.md", async () => {
    await runInit({
      yes: true,
      tools: "codex",
      level: "L2",
      dir,
      noVerify: true,
    });
    const content = readFileSync(join(dir, ".agents", "CODEX.md"), "utf-8");
    expect(content).toContain("AGENTS.md");
  });

  it("skips existing hooks files on re-run", async () => {
    await runInit({
      yes: true,
      tools: "claude",
      level: "L2",
      dir,
      noVerify: true,
    });
    const hookPath = join(dir, ".claude", "hooks", "stop-dangerous.mjs");
    const original = readFileSync(hookPath, "utf-8");

    // Second run — hook must not be overwritten
    await runInit({
      yes: true,
      tools: "claude",
      level: "L2",
      dir,
      noVerify: true,
    });
    const after = readFileSync(hookPath, "utf-8");
    expect(after).toBe(original);
  });

  it("generates with --level L1", async () => {
    await runInit({
      yes: true,
      tools: "claude,codex",
      level: "L1",
      dir,
      noVerify: true,
    });
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(true);
  });
});

describe("arbiter init — verify integration", () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
    initGit(dir);
    vi.mocked(runProbes).mockReturnValue({
      dir: "",
      stack: "unknown",
      probes: [],
      hasFailures: false,
    });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("skips probes when noVerify=true", async () => {
    await runInit({
      yes: true,
      tools: "claude",
      level: "L2",
      dir,
      noVerify: true,
    });
    expect(vi.mocked(runProbes)).not.toHaveBeenCalled();
  });

  it("calls runProbes after generation when noVerify=false", async () => {
    await runInit({
      yes: true,
      tools: "claude",
      level: "L2",
      dir,
      noVerify: false,
    });
    expect(vi.mocked(runProbes)).toHaveBeenCalledWith(dir);
  });

  it("exits non-zero when probes fail and noVerify=false", async () => {
    vi.mocked(runProbes).mockReturnValue({
      dir,
      stack: "java",
      probes: [
        { tool: "gradle", status: "failed", reason: "version 6.0 outside >=7" },
      ],
      hasFailures: true,
    });
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {}) as (code?: number) => never);
    await runInit({
      yes: true,
      tools: "claude",
      level: "L2",
      dir,
      noVerify: false,
    });
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe("runGenerators — debt ratchet", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-ratchet-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("generates debt ratchet scripts when enableDebtGates is true", () => {
    const config = makeConfig(dir, { enableDebtGates: true, useGitHub: true });
    const results = runGenerators(config);
    const paths = results.map((r) => r.path);
    expect(paths.some((p) => p.includes("capture-debt-baseline.mjs"))).toBe(
      true,
    );
    expect(paths.some((p) => p.includes("debt-report.mjs"))).toBe(true);
  });

  it("does not generate debt ratchet scripts when enableDebtGates is false", () => {
    const config = makeConfig(dir, {
      enableDebtGates: false,
      governanceLevel: "L1",
    });
    const results = runGenerators(config);
    const paths = results.map((r) => r.path);
    expect(paths.some((p) => p.includes("capture-debt-baseline.mjs"))).toBe(
      false,
    );
    expect(paths.some((p) => p.includes("debt-report.mjs"))).toBe(false);
  });
});
