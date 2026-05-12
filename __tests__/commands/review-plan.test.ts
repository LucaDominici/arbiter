import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runReviewPlan } from "../../src/commands/review.js";
import type { SubagentDispatcher } from "../../src/review/dispatch.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "..", "fixtures", "plans");

function withProjectDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "arbiter-review-cmd-"));
  writeFileSync(join(dir, "AGENTS.md"), "# project agents\n");
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function disp(verdict: "PASS" | "WARN" | "FAIL"): SubagentDispatcher {
  return {
    run: () => ({ stdout: `verdict: ${verdict}\n`, exitCode: 0 }),
  };
}

describe("runReviewPlan (#235)", () => {
  let env: ReturnType<typeof withProjectDir>;
  beforeEach(() => {
    env = withProjectDir();
  });
  afterEach(() => env.cleanup());

  it("returns exit code 0 for pass fixture", () => {
    const result = runReviewPlan({
      file: join(FIXTURES, "pass.md"),
      dir: env.dir,
      dispatcher: disp("PASS"),
    });
    expect(result.exitCode).toBe(0);
    expect(result.verdict).toBe("PASS");
  });

  it("returns exit code 1 for warn fixture", () => {
    const result = runReviewPlan({
      file: join(FIXTURES, "warn.md"),
      dir: env.dir,
      dispatcher: disp("WARN"),
    });
    expect(result.exitCode).toBe(1);
  });

  it("returns exit code 2 for fail fixture", () => {
    const result = runReviewPlan({
      file: join(FIXTURES, "fail.md"),
      dir: env.dir,
      dispatcher: disp("FAIL"),
    });
    expect(result.exitCode).toBe(2);
    expect(result.verdict).toBe("FAIL");
  });

  it("returns exit code 2 with ERROR verdict when file is missing", () => {
    const result = runReviewPlan({
      file: join(env.dir, "nonexistent.md"),
      dir: env.dir,
      dispatcher: disp("PASS"),
    });
    expect(result.exitCode).toBe(2);
    expect(result.verdict).toBe("ERROR");
  });
});
