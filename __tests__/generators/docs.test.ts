import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateDocs } from "../../src/generators/docs.js";
import { makeConfig } from "../helpers.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "arbiter-docs-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("generateDocs — ADR template (#192)", () => {
  it("emits ADR-000_template.md at L2", () => {
    generateDocs(makeConfig(dir, { governanceLevel: "L2" }));
    expect(existsSync(join(dir, "docs", "adr", "ADR-000_template.md"))).toBe(
      true,
    );
  });

  it("emits ADR-000_template.md at L3", () => {
    generateDocs(makeConfig(dir, { governanceLevel: "L3" }));
    expect(existsSync(join(dir, "docs", "adr", "ADR-000_template.md"))).toBe(
      true,
    );
  });

  it("does not emit ADR template at L1", () => {
    generateDocs(makeConfig(dir, { governanceLevel: "L1" }));
    expect(existsSync(join(dir, "docs", "adr", "ADR-000_template.md"))).toBe(
      false,
    );
  });
});

describe("generateDocs — SECURE_CODING_CHECKLIST (#203)", () => {
  it("emits SECURE_CODING_CHECKLIST.md at L2", () => {
    generateDocs(makeConfig(dir, { governanceLevel: "L2" }));
    expect(existsSync(join(dir, "docs", "SECURE_CODING_CHECKLIST.md"))).toBe(
      true,
    );
  });

  it("emits SECURE_CODING_CHECKLIST.md at L3", () => {
    generateDocs(makeConfig(dir, { governanceLevel: "L3" }));
    expect(existsSync(join(dir, "docs", "SECURE_CODING_CHECKLIST.md"))).toBe(
      true,
    );
  });

  it("does not emit SECURE_CODING_CHECKLIST.md at L1", () => {
    generateDocs(makeConfig(dir, { governanceLevel: "L1" }));
    expect(existsSync(join(dir, "docs", "SECURE_CODING_CHECKLIST.md"))).toBe(
      false,
    );
  });
});
