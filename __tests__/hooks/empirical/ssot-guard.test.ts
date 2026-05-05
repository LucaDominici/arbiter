import { spawnSync } from "node:child_process";
import { join } from "node:path";

const HOOK = join(
  process.cwd(),
  "src/templates/claude/hooks/pre-edit-ssot-guard.mjs",
);

function run(filePath: string, extraEnv: Record<string, string> = {}) {
  return spawnSync("node", [HOOK], {
    encoding: "utf-8",
    env: { ...process.env, CLAUDE_TOOL_INPUT_PATH: filePath, ...extraEnv },
  });
}

describe("pre-edit-ssot-guard", () => {
  it("exits 2 when editing AGENTS.md", () => {
    const result = run("AGENTS.md");
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("SSOT GUARD");
  });

  it("exits 2 when editing .claude/CLAUDE.md", () => {
    const result = run(".claude/CLAUDE.md");
    expect(result.status).toBe(2);
  });

  it("exits 2 when editing docs/SYSTEM/DECISIONS.md", () => {
    const result = run("docs/SYSTEM/DECISIONS.md");
    expect(result.status).toBe(2);
  });

  it("exits 0 for non-SSOT files", () => {
    const result = run("src/commands/init.ts");
    expect(result.status).toBe(0);
  });

  it("exits 0 when ARBITER_SSOT_BYPASS=1 even on SSOT file", () => {
    const result = run("AGENTS.md", { ARBITER_SSOT_BYPASS: "1" });
    expect(result.status).toBe(0);
  });
});
