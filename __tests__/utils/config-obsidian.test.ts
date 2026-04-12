import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveConfig, loadConfig } from "../../src/utils/config.js";

describe("ArbiterConfig.enableObsidianVault", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-cfg-obs-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("persists enableObsidianVault=true round-trip", () => {
    saveConfig(dir, {
      version: "0.1",
      tools: ["claude"],
      governanceLevel: "L2",
      useGitHub: false,
      enableObsidianVault: true,
    });
    const loaded = loadConfig(dir);
    expect(loaded?.enableObsidianVault).toBe(true);
  });

  it("omits enableObsidianVault when not set", () => {
    saveConfig(dir, {
      version: "0.1",
      tools: ["claude"],
      governanceLevel: "L2",
      useGitHub: false,
    });
    const loaded = loadConfig(dir);
    expect(loaded?.enableObsidianVault).toBeUndefined();
  });
});
