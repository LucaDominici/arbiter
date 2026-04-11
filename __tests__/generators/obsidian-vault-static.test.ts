import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateStaticVaultFiles } from "../../src/generators/obsidian-vault-static.js";
import { makeConfig } from "../helpers.js";

describe("generateStaticVaultFiles", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-vault-static-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates .obsidian/app.json and graph.json", () => {
    const result = generateStaticVaultFiles(makeConfig(dir));
    expect(result.files.length).toBeGreaterThan(0);
    expect(existsSync(join(dir, "docs/vault/.obsidian/app.json"))).toBe(true);
    expect(existsSync(join(dir, "docs/vault/.obsidian/graph.json"))).toBe(true);
  });

  it("creates PRD templates", () => {
    generateStaticVaultFiles(makeConfig(dir));
    expect(existsSync(join(dir, "docs/vault/prd/_template.md"))).toBe(true);
    expect(existsSync(join(dir, "docs/vault/prd/_impact-template.md"))).toBe(
      true,
    );
  });

  it("creates decision template", () => {
    expect(
      existsSync(join(dir, "docs/vault/governance/decisions/_template.md")),
    ).toBe(false);
    generateStaticVaultFiles(makeConfig(dir));
    expect(
      existsSync(join(dir, "docs/vault/governance/decisions/_template.md")),
    ).toBe(true);
  });

  it("index contains project name", () => {
    generateStaticVaultFiles(makeConfig(dir, { projectName: "poc-project" }));
    const content = readFileSync(join(dir, "docs/vault/00-INDEX.md"), "utf-8");
    expect(content).toContain("poc-project");
    expect(content).toContain("arbiter:generated");
  });
});
