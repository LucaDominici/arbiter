import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateRoot } from "../../src/generators/root.js";
import { makeConfig } from "../helpers.js";

describe("generateRoot", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-root-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("generates SECURITY.md, CONTRIBUTING.md, and .editorconfig", () => {
    const result = generateRoot(makeConfig(dir));
    const paths = result.files.map((f) => f.path);
    expect(paths.some((p) => p.endsWith("SECURITY.md"))).toBe(true);
    expect(paths.some((p) => p.endsWith("CONTRIBUTING.md"))).toBe(true);
    expect(paths.some((p) => p.endsWith(".editorconfig"))).toBe(true);
  });

  it("generates CODEOWNERS when githubOwner is set", () => {
    const result = generateRoot(makeConfig(dir, { githubOwner: "test-owner" }));
    const paths = result.files.map((f) => f.path);
    expect(paths.some((p) => p.endsWith("CODEOWNERS"))).toBe(true);
    const content = readFileSync(join(dir, ".github", "CODEOWNERS"), "utf-8");
    expect(content).toContain("test-owner");
  });

  it("does not generate CODEOWNERS when githubOwner is null", () => {
    const result = generateRoot(makeConfig(dir, { githubOwner: null }));
    const paths = result.files.map((f) => f.path);
    expect(paths.every((p) => !p.endsWith("CODEOWNERS"))).toBe(true);
  });

  it("skips existing files on second run (skipIfExists)", () => {
    generateRoot(makeConfig(dir));
    const securityPath = join(dir, "SECURITY.md");

    // Write custom content to SECURITY.md
    writeFileSync(securityPath, "CUSTOM CONTENT");

    // Second run should skip
    const result = generateRoot(makeConfig(dir));
    const securityResult = result.files.find((f) =>
      f.path.endsWith("SECURITY.md"),
    );
    expect(securityResult!.action).toBe("skipped");
    expect(readFileSync(securityPath, "utf-8")).toBe("CUSTOM CONTENT");
  });

  it("CONTRIBUTING.md contains project name and test command", () => {
    generateRoot(
      makeConfig(dir, {
        projectName: "root-proj",
        testCommand: "npm test",
        githubOwner: "owner",
        githubRepo: "repo",
      }),
    );
    const content = readFileSync(join(dir, "CONTRIBUTING.md"), "utf-8");
    expect(content).toContain("root-proj");
    expect(content).toContain("npm test");
  });

  it("generates commitlint.config.js (#202)", () => {
    const result = generateRoot(makeConfig(dir));
    const paths = result.files.map((f) => f.path);
    expect(paths.some((p) => p.endsWith("commitlint.config.js"))).toBe(true);
  });

  it("skipIfExists on commitlint.config.js (#202)", () => {
    const commitlintPath = join(dir, "commitlint.config.js");
    writeFileSync(commitlintPath, "// custom content");
    const result = generateRoot(makeConfig(dir));
    const entry = result.files.find((f) =>
      f.path.endsWith("commitlint.config.js"),
    );
    expect(entry?.action).toBe("skipped");
    expect(readFileSync(commitlintPath, "utf-8")).toBe("// custom content");
  });
});
