import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGenerators } from "../../src/commands/init.js";
import { makeConfig } from "../helpers.js";

describe("runGenerators with enableObsidianVault", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-init-obs-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("generates the vault when enableObsidianVault=true", () => {
    runGenerators(makeConfig(dir, { enableObsidianVault: true }));
    expect(existsSync(join(dir, "docs/vault/00-INDEX.md"))).toBe(true);
  });

  it("does not generate the vault when the flag is missing", () => {
    runGenerators(makeConfig(dir));
    expect(existsSync(join(dir, "docs/vault/00-INDEX.md"))).toBe(false);
  });
});
