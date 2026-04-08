import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  createTestProject,
  initGit,
  cleanupTestProject,
  makeConfig,
} from "../helpers.js";
import { generateGithub } from "../../src/generators/github.js";

describe("tool output: github", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestProject("typescript");
    initGit(dir);
  });

  afterEach(() => {
    cleanupTestProject(dir);
  });

  function githubConfig(
    overrides: Partial<Parameters<typeof makeConfig>[1]> = {},
  ) {
    return makeConfig(dir, {
      useGitHub: true,
      languageHooks: [],
      ...overrides,
    });
  }

  it("generates CI workflow, PR template, 5 issue templates, and dependabot (8 files total)", () => {
    const config = githubConfig();
    const result = generateGithub(config);
    expect(result.files).toHaveLength(8);
  });

  it("dependabot.yml includes npm package ecosystem for TypeScript projects", () => {
    const config = githubConfig({ buildTool: "npm" });
    generateGithub(config);
    const content = readFileSync(
      join(dir, ".github", "dependabot.yml"),
      "utf-8",
    );
    expect(content).toContain("npm");
  });

  it("dependabot.yml always includes github-actions ecosystem", () => {
    const config = githubConfig();
    generateGithub(config);
    const content = readFileSync(
      join(dir, ".github", "dependabot.yml"),
      "utf-8",
    );
    expect(content).toContain("github-actions");
  });

  it("all files have created action on a fresh project", () => {
    const config = githubConfig();
    const result = generateGithub(config);
    for (const f of result.files) {
      expect(f.action, `${f.path} should be created`).toBe("created");
    }
  });

  it("existing CI workflow is skipped on re-run (skipIfExists)", () => {
    const workflowsDir = join(dir, ".github", "workflows");
    mkdirSync(workflowsDir, { recursive: true });
    writeFileSync(join(workflowsDir, "ci.yml"), "# custom ci");
    const config = githubConfig();
    const result = generateGithub(config);
    const ci = result.files.find((f) => f.path.endsWith("ci.yml"));
    expect(ci?.action).toBe("skipped");
  });
});
