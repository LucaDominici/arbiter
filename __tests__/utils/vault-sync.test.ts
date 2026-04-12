import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeVaultFile } from "../../src/utils/vault-sync.js";

const GENERATED =
  "---\ntitle: x\n---\n<!-- arbiter:generated source=test -->\n# hello\n";
const MANUAL = "---\ntitle: x\n---\n# written by human\n";

describe("writeVaultFile", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-vault-sync-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates new file when absent", () => {
    const p = join(dir, "a.md");
    const r = writeVaultFile(p, GENERATED);
    expect(r.action).toBe("created");
    expect(readFileSync(p, "utf-8")).toBe(GENERATED);
  });

  it("overwrites a file that has the arbiter marker", () => {
    const p = join(dir, "b.md");
    writeFileSync(p, GENERATED);
    const updated = GENERATED.replace("hello", "world");
    const r = writeVaultFile(p, updated);
    expect(r.action).toBe("backed-up-and-replaced");
    expect(readFileSync(p, "utf-8")).toContain("world");
  });

  it("preserves files without the marker", () => {
    const p = join(dir, "c.md");
    writeFileSync(p, MANUAL);
    const r = writeVaultFile(p, GENERATED);
    expect(r.action).toBe("skipped");
    expect(readFileSync(p, "utf-8")).toBe(MANUAL);
  });

  it("force=true overwrites even non-generated files", () => {
    const p = join(dir, "d.md");
    writeFileSync(p, MANUAL);
    const r = writeVaultFile(p, GENERATED, { force: true });
    expect(r.action).toBe("backed-up-and-replaced");
    expect(readFileSync(p, "utf-8")).toContain("arbiter:generated");
  });

  it("creates parent directories", () => {
    const p = join(dir, "nested", "deep", "e.md");
    const r = writeVaultFile(p, GENERATED);
    expect(r.action).toBe("created");
  });
});
