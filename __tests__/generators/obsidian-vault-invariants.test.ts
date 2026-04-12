import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { generateInvariantNotes } from "../../src/generators/obsidian-vault-invariants.js";
import { makeConfig } from "../helpers.js";

describe("generateInvariantNotes", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-vault-inv-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates one file per filtered invariant plus an index", () => {
    const result = generateInvariantNotes(makeConfig(dir));
    expect(result.files.length).toBeGreaterThan(1);
    expect(
      existsSync(join(dir, "docs/vault/governance/invariants/_index.md")),
    ).toBe(true);
    expect(
      existsSync(join(dir, "docs/vault/governance/invariants/INV-01.md")),
    ).toBe(true);
  });

  it("invariant notes have parseable frontmatter with required keys", () => {
    generateInvariantNotes(makeConfig(dir));
    const content = readFileSync(
      join(dir, "docs/vault/governance/invariants/INV-01.md"),
      "utf-8",
    );
    const fmMatch = content.match(/^---\n([\s\S]+?)\n---/);
    expect(fmMatch).not.toBeNull();
    const fm = parseYaml(fmMatch![1]) as Record<string, unknown>;
    expect(fm.id).toBe("INV-01");
    expect(fm.tier).toBe("architectural");
    expect(Array.isArray(fm["affects-modules"])).toBe(true);
    expect(Array.isArray(fm["gh-issues"])).toBe(true);
    expect(Array.isArray(fm.tags)).toBe(true);
  });

  it("invariant notes contain the generation marker", () => {
    generateInvariantNotes(makeConfig(dir));
    const content = readFileSync(
      join(dir, "docs/vault/governance/invariants/INV-01.md"),
      "utf-8",
    );
    expect(content).toContain("<!-- arbiter:generated source=");
  });

  it("frontmatter values are not HTML-escaped", () => {
    generateInvariantNotes(makeConfig(dir));
    const content = readFileSync(
      join(dir, "docs/vault/governance/invariants/INV-01.md"),
      "utf-8",
    );
    expect(content).not.toContain("&#34;");
    expect(content).not.toContain("&amp;");
    expect(content).not.toContain("&lt;");

    const fm = parseYaml(content.match(/^---\n([\s\S]+?)\n---/)![1]) as Record<
      string,
      unknown
    >;
    expect(fm.title).toBe("No circular dependencies between modules");
  });

  it("filters invariants by governance level (L3 >= L1)", () => {
    const l1 = generateInvariantNotes(
      makeConfig(dir, { governanceLevel: "L1" }),
    );
    const dirL3 = mkdtempSync(join(tmpdir(), "arbiter-vault-inv-l3-"));
    try {
      const l3 = generateInvariantNotes(
        makeConfig(dirL3, { governanceLevel: "L3" }),
      );
      expect(l3.files.length).toBeGreaterThanOrEqual(l1.files.length);
    } finally {
      rmSync(dirL3, { recursive: true, force: true });
    }
  });
});
