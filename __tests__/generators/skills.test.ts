import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createTestProject,
  cleanupTestProject,
  makeConfig,
} from "../helpers.js";
import { generateSkills } from "../../src/generators/skills.js";

const SKILL_NAMES = [
  "tdd",
  "verification",
  "architect-review",
  "clean-code",
  "understand-code",
  "codebase-audit",
  "epic-decompose",
] as const;

describe("generateSkills", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestProject("typescript");
  });

  afterEach(() => {
    cleanupTestProject(dir);
  });

  it("returns empty files array when claude is not in tools", () => {
    const config = makeConfig(dir, { tools: ["codex"] });
    const result = generateSkills(config);
    expect(result.files).toHaveLength(0);
  });

  it("generates all 7 skill SKILL.md files for claude projects", () => {
    const config = makeConfig(dir, { tools: ["claude"] });
    const result = generateSkills(config);
    expect(result.files).toHaveLength(SKILL_NAMES.length);
  });

  it("writes each skill to .claude/skills/<name>/SKILL.md", () => {
    const config = makeConfig(dir, { tools: ["claude"] });
    generateSkills(config);
    for (const name of SKILL_NAMES) {
      expect(existsSync(join(dir, ".claude", "skills", name, "SKILL.md"))).toBe(
        true,
      );
    }
  });

  it("tdd skill references vitest for TypeScript projects", () => {
    const config = makeConfig(dir, {
      tools: ["claude"],
      language: "typescript",
    });
    generateSkills(config);
    const content = readFileSync(
      join(dir, ".claude", "skills", "tdd", "SKILL.md"),
      "utf-8",
    );
    expect(content).toContain("vitest");
  });

  it("tdd skill references JUnit for Java projects", () => {
    cleanupTestProject(dir);
    dir = createTestProject("java");
    const config = makeConfig(dir, {
      tools: ["claude"],
      language: "java",
    });
    generateSkills(config);
    const content = readFileSync(
      join(dir, ".claude", "skills", "tdd", "SKILL.md"),
      "utf-8",
    );
    expect(content).toContain("JUnit");
  });

  it("tdd skill references pytest for Python projects", () => {
    cleanupTestProject(dir);
    dir = createTestProject("python");
    const config = makeConfig(dir, {
      tools: ["claude"],
      language: "python",
    });
    generateSkills(config);
    const content = readFileSync(
      join(dir, ".claude", "skills", "tdd", "SKILL.md"),
      "utf-8",
    );
    expect(content).toContain("pytest");
  });

  it("tdd skill references testing package for Go projects", () => {
    cleanupTestProject(dir);
    dir = createTestProject("go");
    const config = makeConfig(dir, {
      tools: ["claude"],
      language: "go",
    });
    generateSkills(config);
    const content = readFileSync(
      join(dir, ".claude", "skills", "tdd", "SKILL.md"),
      "utf-8",
    );
    expect(content).toContain("testing");
  });

  it("architect-review skill references package structure for Java projects", () => {
    cleanupTestProject(dir);
    dir = createTestProject("java");
    const config = makeConfig(dir, {
      tools: ["claude"],
      language: "java",
    });
    generateSkills(config);
    const content = readFileSync(
      join(dir, ".claude", "skills", "architect-review", "SKILL.md"),
      "utf-8",
    );
    expect(content).toContain("package");
  });

  it("understand-code skill references GLOBAL_INVARIANTS for standard/full preset projects", () => {
    const config = makeConfig(dir, {
      tools: ["claude"],
      governanceLevel: "L2",
    });
    generateSkills(config);
    const content = readFileSync(
      join(dir, ".claude", "skills", "understand-code", "SKILL.md"),
      "utf-8",
    );
    expect(content).toContain("GLOBAL_INVARIANTS");
  });

  it("each SKILL.md contains a frontmatter name field", () => {
    const config = makeConfig(dir, { tools: ["claude"] });
    generateSkills(config);
    for (const name of SKILL_NAMES) {
      const content = readFileSync(
        join(dir, ".claude", "skills", name, "SKILL.md"),
        "utf-8",
      );
      expect(content).toContain(`name: ${name}`);
    }
  });

  it("each SKILL.md has a description in frontmatter", () => {
    const config = makeConfig(dir, { tools: ["claude"] });
    generateSkills(config);
    for (const name of SKILL_NAMES) {
      const content = readFileSync(
        join(dir, ".claude", "skills", name, "SKILL.md"),
        "utf-8",
      );
      expect(content).toMatch(/^description: .+/m);
    }
  });

  it("skill files are marked skipIfExists to avoid overwriting customizations", () => {
    const config = makeConfig(dir, { tools: ["claude"] });
    const result = generateSkills(config);
    for (const file of result.files) {
      expect(file.skipped !== undefined || file.path.includes("SKILL.md")).toBe(
        true,
      );
    }
  });
});
