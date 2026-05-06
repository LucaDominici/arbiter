import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderTemplate } from "../../../src/utils/render.js";
import { makeConfig } from "../../helpers.js";

function configFor() {
  return makeConfig("/tmp/test", {
    language: "typescript",
    governanceLevel: "L2",
    buildTool: "npm",
    testCommand: "npm test",
    lintCommand: "npm run lint",
    formatCommand: "npx prettier --write",
  });
}

function setup(phase: string, planContent: string | null, planPath?: string) {
  const dir = mkdtempSync(join(tmpdir(), "arbiter-plan-anchor-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: dir, stdio: "ignore" });
  const hooksDir = join(dir, ".claude", "hooks");
  mkdirSync(hooksDir, { recursive: true });

  writeFileSync(
    join(hooksDir, "lib.mjs"),
    renderTemplate("claude/hooks/lib.mjs.ejs", configFor()),
  );

  const hookPath = join(hooksDir, "pre-edit-plan-anchor.mjs");
  writeFileSync(
    hookPath,
    renderTemplate("claude/hooks/pre-edit-plan-anchor.mjs.ejs", configFor()),
  );

  writeFileSync(join(dir, ".claude", ".task-phase"), phase + "\n");

  const resolvedPlanPath = planPath ?? join(dir, ".claude", "plans", "task.md");
  if (planContent !== null) {
    mkdirSync(join(dir, ".claude", "plans"), { recursive: true });
    writeFileSync(resolvedPlanPath, planContent);
    writeFileSync(join(dir, ".claude", ".task-plan"), resolvedPlanPath + "\n");
  } else {
    writeFileSync(join(dir, ".claude", ".task-plan"), "unknown\n");
  }

  return { dir, hookPath };
}

function run(
  hookPath: string,
  cwd: string,
  extraEnv: Record<string, string> = {},
) {
  return spawnSync("node", [hookPath], {
    cwd,
    encoding: "utf-8",
    env: { ...process.env, CLAUDE_TOOL_INPUT_PATH: "src/foo.ts", ...extraEnv },
  });
}

describe("pre-edit-plan-anchor", () => {
  it("exits 0 when phase is not implementation (plan missing)", () => {
    const { dir, hookPath } = setup("plan", null);
    try {
      expect(run(hookPath, dir).status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits 2 when implementation phase and plan is unknown", () => {
    const { dir, hookPath } = setup("implementation", null);
    try {
      const result = run(hookPath, dir);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("PLAN ANCHOR");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits 2 when implementation phase and plan path does not exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "arbiter-plan-anchor-"));
    execFileSync("git", ["init", "-b", "main"], { cwd: dir, stdio: "ignore" });
    const hooksDir = join(dir, ".claude", "hooks");
    mkdirSync(hooksDir, { recursive: true });
    writeFileSync(
      join(hooksDir, "lib.mjs"),
      renderTemplate("claude/hooks/lib.mjs.ejs", configFor()),
    );
    const hookPath = join(hooksDir, "pre-edit-plan-anchor.mjs");
    writeFileSync(
      hookPath,
      renderTemplate("claude/hooks/pre-edit-plan-anchor.mjs.ejs", configFor()),
    );
    writeFileSync(join(dir, ".claude", ".task-phase"), "implementation\n");
    writeFileSync(
      join(dir, ".claude", ".task-plan"),
      "/nonexistent/path/to/plan.md\n",
    );
    try {
      const result = run(hookPath, dir);
      expect(result.status).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits 0 and injects plan when implementation phase and valid plan", () => {
    const { dir, hookPath } = setup(
      "implementation",
      "# My Plan\nStep 1: do something\n",
    );
    try {
      const result = run(hookPath, dir);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("ACTIVE PLAN");
      expect(result.stdout).toContain("Step 1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits 0 when ARBITER_PLAN_BYPASS=1 even in implementation with no plan", () => {
    const { dir, hookPath } = setup("implementation", null);
    try {
      expect(run(hookPath, dir, { ARBITER_PLAN_BYPASS: "1" }).status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
