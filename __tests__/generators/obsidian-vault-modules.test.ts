import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { generateModuleNotes } from "../../src/generators/obsidian-vault-modules.js";
import { makeConfig } from "../helpers.js";

describe("generateModuleNotes", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-vault-mods-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("generates a module note per detected module", () => {
    mkdirSync(join(dir, "src"), { recursive: true });
    mkdirSync(join(dir, "backend"), { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "root" }));

    const result = generateModuleNotes(makeConfig(dir));
    expect(result.files.length).toBeGreaterThan(0);
    expect(
      existsSync(join(dir, "docs/vault/architecture/modules/src.md")),
    ).toBe(true);
    expect(
      existsSync(join(dir, "docs/vault/architecture/modules/backend.md")),
    ).toBe(true);
  });

  it("generates an index, stack, and dependencies note", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "root" }));
    generateModuleNotes(makeConfig(dir));
    expect(
      existsSync(join(dir, "docs/vault/architecture/modules/_index.md")),
    ).toBe(true);
    expect(existsSync(join(dir, "docs/vault/architecture/stack.md"))).toBe(
      true,
    );
    expect(
      existsSync(join(dir, "docs/vault/architecture/dependencies.md")),
    ).toBe(true);
  });

  it("module note has parseable frontmatter with required keys", () => {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "root" }));
    generateModuleNotes(makeConfig(dir));
    const content = readFileSync(
      join(dir, "docs/vault/architecture/modules/src.md"),
      "utf-8",
    );
    const fmMatch = content.match(/^---\n([\s\S]+?)\n---/);
    expect(fmMatch).not.toBeNull();
    const fm = parseYaml(fmMatch![1]) as Record<string, unknown>;
    expect(fm.name).toBe("src");
    expect(fm.kind).toBe("subdir");
    expect(Array.isArray(fm["affects-invariants"])).toBe(true);
    expect(Array.isArray(fm.tags)).toBe(true);
  });

  it("stack.md contains the project build command", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "root" }));
    generateModuleNotes(makeConfig(dir, { buildCommand: "pnpm build:all" }));
    const content = readFileSync(
      join(dir, "docs/vault/architecture/stack.md"),
      "utf-8",
    );
    expect(content).toContain("pnpm build:all");
  });
});
