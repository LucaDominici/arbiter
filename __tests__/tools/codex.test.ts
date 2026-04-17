import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  createTestProject,
  initGit,
  cleanupTestProject,
  makeConfig,
} from "../helpers.js";
import { generateCodex } from "../../src/generators/codex.js";

describe("tool output: codex", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestProject("typescript");
    initGit(dir);
  });

  afterEach(() => {
    cleanupTestProject(dir);
  });

  function codexConfig(
    overrides: Partial<Parameters<typeof makeConfig>[1]> = {},
  ) {
    return makeConfig(dir, {
      tools: ["codex"],
      languageHooks: [],
      ...overrides,
    });
  }

  it("CODEX.md references AGENTS.md as canonical source", () => {
    const config = codexConfig();
    generateCodex(config);
    const content = readFileSync(join(dir, ".agents", "CODEX.md"), "utf-8");
    expect(content).toContain("AGENTS.md");
    expect(content).toContain("canonical");
  });

  it("CODEX.md contains project name in header", () => {
    const config = codexConfig();
    generateCodex(config);
    const content = readFileSync(join(dir, ".agents", "CODEX.md"), "utf-8");
    expect(content).toContain("test-project");
  });

  it("CODEX.md includes plan JSON schema with required fields", () => {
    const config = codexConfig();
    generateCodex(config);
    const content = readFileSync(join(dir, ".agents", "CODEX.md"), "utf-8");
    expect(content).toContain("PLAN.json");
    expect(content).toContain("run_id");
    expect(content).toContain("task_id");
  });

  it("CODEX.md includes command translation table", () => {
    const config = codexConfig();
    generateCodex(config);
    const content = readFileSync(join(dir, ".agents", "CODEX.md"), "utf-8");
    expect(content).toContain("/task");
  });

  it("generates 3 rules files in .agents/rules/", () => {
    const config = codexConfig();
    generateCodex(config);
    const rulesDir = join(dir, ".agents", "rules");
    expect(existsSync(join(rulesDir, "05-agent-lifecycle.md"))).toBe(true);
    expect(existsSync(join(rulesDir, "25-todo-folder-policy.md"))).toBe(true);
    expect(existsSync(join(rulesDir, "90-exec-protocol.md"))).toBe(true);
  });

  it("generates plan directory README referencing PLAN.json", () => {
    const config = codexConfig();
    generateCodex(config);
    const readme = readFileSync(
      join(dir, ".agents", "plan", "README.md"),
      "utf-8",
    );
    expect(readme).toContain("PLAN.json");
  });

  it("result lists exactly 5 files all with created action", () => {
    const config = codexConfig();
    const result = generateCodex(config);
    expect(result.files).toHaveLength(5);
    for (const f of result.files) {
      expect(f.action).toBe("created");
    }
  });

  it("rules files use skipIfExists on second run", () => {
    const config = codexConfig();
    // Pre-create one rule file
    const rulesDir = join(dir, ".agents", "rules");
    mkdirSync(rulesDir, { recursive: true });
    writeFileSync(
      join(rulesDir, "05-agent-lifecycle.md"),
      "# existing content",
    );
    const result = generateCodex(config);
    const agentLifecycle = result.files.find((f) =>
      f.path.endsWith("05-agent-lifecycle.md"),
    );
    expect(agentLifecycle?.action).toBe("skipped");
  });
});
