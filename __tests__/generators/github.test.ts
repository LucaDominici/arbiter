import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateGithub } from "../../src/generators/github.js";
import { makeConfig } from "../helpers.js";

describe("generateGithub", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-github-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("generates CI workflow, PR template, issue templates, and dependabot", () => {
    const result = generateGithub(makeConfig(dir));
    const paths = result.files.map((f) => f.path);
    expect(paths.some((p) => p.includes("ci.yml"))).toBe(true);
    expect(paths.some((p) => p.includes("PULL_REQUEST_TEMPLATE.md"))).toBe(
      true,
    );
    expect(paths.some((p) => p.includes("dependabot.yml"))).toBe(true);
    expect(paths.some((p) => p.includes("bug-report.yml"))).toBe(true);
  });

  it("CI workflow contains TypeScript-specific steps", () => {
    generateGithub(makeConfig(dir, { language: "typescript" }));
    const content = readFileSync(
      join(dir, ".github", "workflows", "ci.yml"),
      "utf-8",
    );
    expect(content).toContain("npm ci");
    expect(content).toContain("npm test");
  });

  it("CI workflow contains Java-specific steps", () => {
    generateGithub(makeConfig(dir, { language: "java", buildTool: "gradle" }));
    const content = readFileSync(
      join(dir, ".github", "workflows", "ci.yml"),
      "utf-8",
    );
    expect(content).toContain("gradlew");
    expect(content).toContain("setup-java");
  });

  it("creates all expected issue template files", () => {
    generateGithub(makeConfig(dir));
    const templateDir = join(dir, ".github", "ISSUE_TEMPLATE");
    expect(existsSync(join(templateDir, "bug-report.yml"))).toBe(true);
    expect(existsSync(join(templateDir, "feature-request.yml"))).toBe(true);
    expect(existsSync(join(templateDir, "task-brief.yml"))).toBe(true);
    expect(existsSync(join(templateDir, "config.yml"))).toBe(true);
  });

  it("dependabot.yml contains npm ecosystem for TypeScript", () => {
    generateGithub(
      makeConfig(dir, { language: "typescript", buildTool: "npm" }),
    );
    const content = readFileSync(
      join(dir, ".github", "dependabot.yml"),
      "utf-8",
    );
    expect(content).toContain("npm");
    expect(content).toContain("github-actions");
  });
});

describe("docs-check governance gating", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-github-docs-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("L1 does not include docs-check job", () => {
    generateGithub(makeConfig(dir, { governanceLevel: "L1" }));
    const content = readFileSync(
      join(dir, ".github", "workflows", "ci.yml"),
      "utf-8",
    );
    expect(content).not.toContain("docs-check:");
  });

  it("L2 includes docs-check job", () => {
    generateGithub(makeConfig(dir, { governanceLevel: "L2" }));
    const content = readFileSync(
      join(dir, ".github", "workflows", "ci.yml"),
      "utf-8",
    );
    expect(content).toContain("docs-check:");
  });

  it("L3 includes docs-check job", () => {
    generateGithub(makeConfig(dir, { governanceLevel: "L3" }));
    const content = readFileSync(
      join(dir, ".github", "workflows", "ci.yml"),
      "utf-8",
    );
    expect(content).toContain("docs-check:");
  });

  it("L1 ci-required does not depend on docs-check", () => {
    generateGithub(makeConfig(dir, { governanceLevel: "L1" }));
    const content = readFileSync(
      join(dir, ".github", "workflows", "ci.yml"),
      "utf-8",
    );
    const needsLine = content
      .split("\n")
      .find((line) => line.includes("needs:"));
    expect(needsLine).toBeDefined();
    expect(needsLine).not.toContain("docs-check");
  });

  it("L2 ci-required depends on docs-check", () => {
    generateGithub(makeConfig(dir, { governanceLevel: "L2" }));
    const content = readFileSync(
      join(dir, ".github", "workflows", "ci.yml"),
      "utf-8",
    );
    const needsLine = content
      .split("\n")
      .find((line) => line.includes("needs:"));
    expect(needsLine).toBeDefined();
    expect(needsLine).toContain("docs-check");
  });

  it("docs-check job only runs on pull_request events", () => {
    generateGithub(makeConfig(dir, { governanceLevel: "L2" }));
    const content = readFileSync(
      join(dir, ".github", "workflows", "ci.yml"),
      "utf-8",
    );
    expect(content).toContain("if: github.event_name == 'pull_request'");
  });
});
