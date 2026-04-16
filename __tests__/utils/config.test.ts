import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  saveConfig,
  loadConfig,
  defaultConfig,
} from "../../src/utils/config.js";

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "arbiter-config-test-"));
}

describe("arbiter config", () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("saveConfig creates arbiter.json", () => {
    saveConfig(dir, defaultConfig());
    expect(existsSync(join(dir, "arbiter.json"))).toBe(true);
  });

  it("loadConfig returns null when no file exists", () => {
    expect(loadConfig(dir)).toBeNull();
  });

  it("saveConfig + loadConfig round-trips correctly", () => {
    const config = {
      version: "0.1",
      tools: ["claude", "codex"] as const,
      governanceLevel: "L2" as const,
      useGitHub: true,
    };
    saveConfig(dir, config);
    const loaded = loadConfig(dir);
    expect(loaded).toEqual(config);
  });

  it("defaultConfig returns L2 with claude+codex", () => {
    const config = defaultConfig();
    expect(config.governanceLevel).toBe("L2");
    expect(config.tools).toEqual(["claude", "codex"]);
    expect(config.useGitHub).toBe(false);
  });

  it("loadConfig returns null on malformed JSON", () => {
    vi.spyOn(console, "warn").mockImplementationOnce(() => undefined);
    const path = join(dir, "arbiter.json");
    writeFileSync(path, "{invalid json", "utf-8");
    expect(loadConfig(dir)).toBeNull();
    vi.restoreAllMocks();
  });

  it("saveConfig preserves all tool types", () => {
    const config = {
      version: "0.1",
      tools: ["claude", "codex", "cursor", "copilot"] as const,
      governanceLevel: "L3" as const,
      useGitHub: false,
    };
    saveConfig(dir, config);
    const loaded = loadConfig(dir);
    expect(loaded!.tools).toEqual(["claude", "codex", "cursor", "copilot"]);
    expect(loaded!.governanceLevel).toBe("L3");
  });

  it("saveConfig + loadConfig round-trips invariantTiers", () => {
    const config = {
      version: "0.1",
      tools: ["claude"] as const,
      governanceLevel: "L2" as const,
      useGitHub: false,
      invariantTiers: ["architectural", "data", "governance"] as const,
    };
    saveConfig(dir, config);
    const loaded = loadConfig(dir);
    expect(loaded!.invariantTiers).toEqual([
      "architectural",
      "data",
      "governance",
    ]);
  });

  it("loadConfig returns config without invariantTiers for old format (backwards compat)", () => {
    const path = join(dir, "arbiter.json");
    writeFileSync(
      path,
      JSON.stringify({
        version: "0.1",
        tools: ["claude"],
        governanceLevel: "L2",
        useGitHub: false,
      }),
      "utf-8",
    );
    const loaded = loadConfig(dir);
    expect(loaded).not.toBeNull();
    expect(loaded!.invariantTiers).toBeUndefined();
  });

  it("defaultConfig includes invariantTiers for L2 (standard preset)", () => {
    const config = defaultConfig();
    expect(config.invariantTiers).toBeDefined();
    expect(config.invariantTiers).toContain("architectural");
    expect(config.invariantTiers).toContain("governance");
    expect(config.invariantTiers).toContain("data");
    expect(config.invariantTiers).toContain("operational");
  });
});

describe("arbiter config — MK grace-period fields (ADR-028)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-config-grace-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips graceEndsAt and graceFromLevel through save/load", () => {
    const grace = "2026-05-16T00:00:00.000Z";
    saveConfig(dir, {
      version: "0.1",
      tools: ["claude"],
      governanceLevel: "L2",
      useGitHub: false,
      graceEndsAt: grace,
      graceFromLevel: "L1",
    });
    const loaded = loadConfig(dir);
    expect(loaded?.graceEndsAt).toBe(grace);
    expect(loaded?.graceFromLevel).toBe("L1");
  });

  it("defaultConfig does NOT include graceEndsAt or graceFromLevel", () => {
    const config = defaultConfig();
    expect(config.graceEndsAt).toBeUndefined();
    expect(config.graceFromLevel).toBeUndefined();
  });

  it("loadConfig tolerates arbiter.json without grace fields (backward compat)", () => {
    writeFileSync(
      join(dir, "arbiter.json"),
      JSON.stringify({
        version: "0.1",
        tools: ["claude"],
        governanceLevel: "L1",
        useGitHub: false,
      }),
      "utf-8",
    );
    const loaded = loadConfig(dir);
    expect(loaded).not.toBeNull();
    expect(loaded?.graceEndsAt).toBeUndefined();
    expect(loaded?.graceFromLevel).toBeUndefined();
  });
});

describe("arbiter config — ML contractType field (ADR-028)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-config-contract-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips contractType through save/load", () => {
    saveConfig(dir, {
      version: "0.1",
      tools: ["claude"],
      governanceLevel: "L2",
      useGitHub: false,
      contractType: "graphql",
    });
    const loaded = loadConfig(dir);
    expect(loaded?.contractType).toBe("graphql");
  });

  it("loadConfig tolerates arbiter.json without contractType (backward compat)", () => {
    writeFileSync(
      join(dir, "arbiter.json"),
      JSON.stringify({
        version: "0.1",
        tools: ["claude"],
        governanceLevel: "L2",
        useGitHub: false,
      }),
      "utf-8",
    );
    const loaded = loadConfig(dir);
    expect(loaded).not.toBeNull();
    expect(loaded?.contractType).toBeUndefined();
  });
});
