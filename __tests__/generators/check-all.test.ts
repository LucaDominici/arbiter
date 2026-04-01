import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateCheckAll } from "../../src/generators/check-all.js";
import { makeConfig } from "../helpers.js";

describe("generateCheckAll", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-check-all-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("generates scripts/check-all.sh", () => {
    const result = generateCheckAll(makeConfig(dir));
    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toContain("check-all.sh");
    expect(result.files[0].action).toBe("created");
  });

  it("check-all.sh has shebang line", () => {
    generateCheckAll(makeConfig(dir));
    const content = readFileSync(join(dir, "scripts", "check-all.sh"), "utf-8");
    expect(content).toMatch(/^#!/);
  });

  it("check-all.sh contains lint and test commands for TypeScript", () => {
    generateCheckAll(makeConfig(dir, { language: "typescript" }));
    const content = readFileSync(join(dir, "scripts", "check-all.sh"), "utf-8");
    expect(content).toContain("eslint");
    expect(content).toContain("npm test");
    expect(content).toContain("prettier");
  });

  it("check-all.sh contains Rust commands for Rust projects", () => {
    generateCheckAll(makeConfig(dir, { language: "rust", buildTool: "cargo" }));
    const content = readFileSync(join(dir, "scripts", "check-all.sh"), "utf-8");
    expect(content).toContain("cargo fmt");
    expect(content).toContain("cargo clippy");
    expect(content).toContain("cargo test");
  });

  it("skips if check-all.sh already exists", () => {
    const scriptsDir = join(dir, "scripts");
    mkdirSync(scriptsDir, { recursive: true });
    writeFileSync(join(scriptsDir, "check-all.sh"), "EXISTING");

    const result = generateCheckAll(makeConfig(dir));
    expect(result.files[0].action).toBe("skipped");
    expect(readFileSync(join(scriptsDir, "check-all.sh"), "utf-8")).toBe(
      "EXISTING",
    );
  });
});
