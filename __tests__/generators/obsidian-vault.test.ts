import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateObsidianVault } from "../../src/generators/obsidian-vault.js";
import { makeConfig } from "../helpers.js";

describe("generateObsidianVault", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-vault-orc-"));
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "orc-test" }),
    );
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("produces a complete vault with index, governance, architecture, prd", () => {
    const result = generateObsidianVault(makeConfig(dir));
    expect(result.files.length).toBeGreaterThan(5);
    expect(existsSync(join(dir, "docs/vault/00-INDEX.md"))).toBe(true);
    expect(
      existsSync(join(dir, "docs/vault/governance/invariants/_index.md")),
    ).toBe(true);
    expect(existsSync(join(dir, "docs/vault/governance/AGENTS.md"))).toBe(true);
    expect(
      existsSync(join(dir, "docs/vault/architecture/modules/_index.md")),
    ).toBe(true);
    expect(existsSync(join(dir, "docs/vault/architecture/stack.md"))).toBe(
      true,
    );
    expect(existsSync(join(dir, "docs/vault/architecture/impact-map.md"))).toBe(
      true,
    );
    expect(existsSync(join(dir, "docs/vault/prd/_template.md"))).toBe(true);
  });

  it("two consecutive runs yield the same file count (idempotent)", () => {
    const first = generateObsidianVault(makeConfig(dir));
    const firstCount = first.files.length;
    const second = generateObsidianVault(makeConfig(dir));
    expect(second.files).toHaveLength(firstCount);
  });

  it("skips github notes when useGitHub=false", () => {
    generateObsidianVault(makeConfig(dir));
    expect(existsSync(join(dir, "docs/vault/github/open-issues.md"))).toBe(
      false,
    );
  });
});
