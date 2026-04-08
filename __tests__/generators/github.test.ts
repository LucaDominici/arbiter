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

describe("task-brief governance gating", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-github-taskbrief-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("L1 task-brief omits Engineering Invariants and Forbidden Patterns", () => {
    generateGithub(makeConfig(dir, { governanceLevel: "L1" }));
    const content = readFileSync(
      join(dir, ".github", "ISSUE_TEMPLATE", "task-brief.yml"),
      "utf-8",
    );
    expect(content).not.toContain("Engineering Invariants");
    expect(content).not.toContain("Forbidden Patterns");
  });

  it("L2 task-brief includes Engineering Invariants and Forbidden Patterns", () => {
    generateGithub(makeConfig(dir, { governanceLevel: "L2" }));
    const content = readFileSync(
      join(dir, ".github", "ISSUE_TEMPLATE", "task-brief.yml"),
      "utf-8",
    );
    expect(content).toContain("Engineering Invariants");
    expect(content).toContain("Forbidden Patterns");
  });

  it("L3 task-brief includes Engineering Invariants and Forbidden Patterns", () => {
    generateGithub(makeConfig(dir, { governanceLevel: "L3" }));
    const content = readFileSync(
      join(dir, ".github", "ISSUE_TEMPLATE", "task-brief.yml"),
      "utf-8",
    );
    expect(content).toContain("Engineering Invariants");
    expect(content).toContain("Forbidden Patterns");
  });

  it("all governance levels include core sections", () => {
    for (const level of ["L1", "L2", "L3"] as const) {
      const levelDir = mkdtempSync(
        join(tmpdir(), "arbiter-github-taskbrief-level-"),
      );
      try {
        generateGithub(makeConfig(levelDir, { governanceLevel: level }));
        const content = readFileSync(
          join(levelDir, ".github", "ISSUE_TEMPLATE", "task-brief.yml"),
          "utf-8",
        );
        expect(content, `${level} missing Context`).toContain(
          "Context & Rationale",
        );
        expect(content, `${level} missing Technical Scope`).toContain(
          "Technical Scope",
        );
        expect(content, `${level} missing Definition of Done`).toContain(
          "Definition of Done",
        );
        expect(content, `${level} missing Acceptance Criteria`).toContain(
          "Acceptance Criteria",
        );
        expect(content, `${level} missing Test Plan`).toContain("Test Plan");
      } finally {
        rmSync(levelDir, { recursive: true, force: true });
      }
    }
  });
});

describe("bug-report template content", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-github-bugreport-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("bug-report contains Severity dropdown", () => {
    generateGithub(makeConfig(dir));
    const content = readFileSync(
      join(dir, ".github", "ISSUE_TEMPLATE", "bug-report.yml"),
      "utf-8",
    );
    expect(content).toContain("Severity");
  });

  it("bug-report contains Steps to Reproduce section", () => {
    generateGithub(makeConfig(dir));
    const content = readFileSync(
      join(dir, ".github", "ISSUE_TEMPLATE", "bug-report.yml"),
      "utf-8",
    );
    expect(content).toContain("Steps to Reproduce");
  });

  it("bug-report contains Acceptance Criteria checkboxes", () => {
    generateGithub(makeConfig(dir));
    const content = readFileSync(
      join(dir, ".github", "ISSUE_TEMPLATE", "bug-report.yml"),
      "utf-8",
    );
    expect(content).toContain("Acceptance Criteria");
  });
});

describe("epic template", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-github-epic-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("epic.yml is generated", () => {
    generateGithub(makeConfig(dir));
    expect(existsSync(join(dir, ".github", "ISSUE_TEMPLATE", "epic.yml"))).toBe(
      true,
    );
  });

  it("epic.yml contains Goal and Sub-tasks sections", () => {
    generateGithub(makeConfig(dir));
    const content = readFileSync(
      join(dir, ".github", "ISSUE_TEMPLATE", "epic.yml"),
      "utf-8",
    );
    expect(content).toContain("Goal");
    expect(content).toContain("Sub-tasks");
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
    const lines = content.split("\n");
    const ciRequiredIdx = lines.findIndex((l) => l.includes("ci-required:"));
    const needsLine = lines
      .slice(ciRequiredIdx)
      .find((l) => l.includes("needs:"));
    expect(needsLine).toBeDefined();
    expect(needsLine).not.toContain("docs-check");
  });

  it("L2 ci-required depends on docs-check", () => {
    generateGithub(makeConfig(dir, { governanceLevel: "L2" }));
    const content = readFileSync(
      join(dir, ".github", "workflows", "ci.yml"),
      "utf-8",
    );
    const lines = content.split("\n");
    const ciRequiredIdx = lines.findIndex((l) => l.includes("ci-required:"));
    const needsLine = lines
      .slice(ciRequiredIdx)
      .find((l) => l.includes("needs:"));
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
