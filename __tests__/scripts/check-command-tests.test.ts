import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const SCRIPT = resolve("scripts/check-command-tests.mjs");

function run(commandsDir: string, testsDir: string) {
  const r = spawnSync(
    "node",
    [SCRIPT, `--commands=${commandsDir}`, `--tests=${testsDir}`],
    { encoding: "utf-8", cwd: resolve(".") },
  );
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

function makeTemp(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "canon06-test-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("check-command-tests.mjs (INV-50 / CANON-06)", () => {
  it("exits 0 when every command has a matching test", () => {
    const { dir, cleanup } = makeTemp();
    try {
      const cmdDir = join(dir, "commands");
      const testDir = join(dir, "tests");
      mkdirSync(cmdDir);
      mkdirSync(testDir);
      writeFileSync(join(cmdDir, "init.ts"), "");
      writeFileSync(join(testDir, "init.test.ts"), "");
      expect(run(cmdDir, testDir).status).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("exits 0 when command has a prefixed test (e.g. init-json.test.ts for init.ts)", () => {
    const { dir, cleanup } = makeTemp();
    try {
      const cmdDir = join(dir, "commands");
      const testDir = join(dir, "tests");
      mkdirSync(cmdDir);
      mkdirSync(testDir);
      writeFileSync(join(cmdDir, "review.ts"), "");
      writeFileSync(join(testDir, "review-code.test.ts"), "");
      writeFileSync(join(testDir, "review-plan.test.ts"), "");
      expect(run(cmdDir, testDir).status).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("exits 1 when a command has no test at all", () => {
    const { dir, cleanup } = makeTemp();
    try {
      const cmdDir = join(dir, "commands");
      const testDir = join(dir, "tests");
      mkdirSync(cmdDir);
      mkdirSync(testDir);
      writeFileSync(join(cmdDir, "deploy.ts"), "");
      const result = run(cmdDir, testDir);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("deploy");
    } finally {
      cleanup();
    }
  });

  it("ignores .d.ts declaration files", () => {
    const { dir, cleanup } = makeTemp();
    try {
      const cmdDir = join(dir, "commands");
      const testDir = join(dir, "tests");
      mkdirSync(cmdDir);
      mkdirSync(testDir);
      writeFileSync(join(cmdDir, "init.ts"), "");
      writeFileSync(join(cmdDir, "init.d.ts"), "");
      writeFileSync(join(testDir, "init.test.ts"), "");
      expect(run(cmdDir, testDir).status).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("passes against the real src/commands and __tests__/commands", () => {
    const result = run(resolve("src/commands"), resolve("__tests__/commands"));
    expect(result.status).toBe(0);
  });
});
