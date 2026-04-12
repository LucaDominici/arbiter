import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generateAgentsSectionedNote,
  generateImpactMap,
} from "../../src/generators/obsidian-vault-index.js";
import { makeConfig } from "../helpers.js";

describe("generateAgentsSectionedNote", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-vault-agents-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes governance/AGENTS.md with project name", () => {
    const result = generateAgentsSectionedNote(
      makeConfig(dir, { projectName: "proj-x" }),
    );
    expect(result.files).toHaveLength(1);
    const content = readFileSync(
      join(dir, "docs/vault/governance/AGENTS.md"),
      "utf-8",
    );
    expect(content).toContain("proj-x");
    expect(content).toContain("arbiter:generated");
  });
});

describe("generateImpactMap", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-vault-impact-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes architecture/impact-map.md with invariant and module sections", () => {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "root" }));

    const result = generateImpactMap(makeConfig(dir));
    expect(result.files).toHaveLength(1);
    const content = readFileSync(
      join(dir, "docs/vault/architecture/impact-map.md"),
      "utf-8",
    );
    expect(content).toContain("## By Invariant");
    expect(content).toContain("## By Module");
    expect(content).toContain("INV-01");
  });
});
