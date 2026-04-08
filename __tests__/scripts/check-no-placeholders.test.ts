import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const SCRIPT = resolve("scripts/check-no-placeholders.mjs");

function runScanner(dir: string): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("node", [SCRIPT, dir], {
    encoding: "utf-8",
    cwd: resolve("."),
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function makeDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "placeholder-test-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("check-no-placeholders scanner", () => {
  it("passes on a clean file", () => {
    const { dir, cleanup } = makeDir();
    try {
      writeFileSync(join(dir, "clean.ts"), 'export function hello(): string { return "world"; }\n');
      const result = runScanner(dir);
      expect(result.status).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("fails on PLACEHOLDER", () => {
    const { dir, cleanup } = makeDir();
    try {
      writeFileSync(join(dir, "bad.ts"), "const x = PLACEHOLDER;\n");
      const result = runScanner(dir);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("PLACEHOLDER");
    } finally {
      cleanup();
    }
  });

  it("fails on FIXME", () => {
    const { dir, cleanup } = makeDir();
    try {
      writeFileSync(join(dir, "bad.ts"), "// FIXME: this is broken\n");
      const result = runScanner(dir);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("FIXME");
    } finally {
      cleanup();
    }
  });

  it("fails on XXX", () => {
    const { dir, cleanup } = makeDir();
    try {
      writeFileSync(join(dir, "bad.ts"), "// XXX remove this\n");
      const result = runScanner(dir);
      expect(result.status).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("fails on HACK", () => {
    const { dir, cleanup } = makeDir();
    try {
      writeFileSync(join(dir, "bad.ts"), "// HACK: workaround\n");
      const result = runScanner(dir);
      expect(result.status).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("fails on standalone WIP", () => {
    const { dir, cleanup } = makeDir();
    try {
      writeFileSync(join(dir, "bad.ts"), "// WIP\n");
      const result = runScanner(dir);
      expect(result.status).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("does not fail on WIP inside a longer word", () => {
    const { dir, cleanup } = makeDir();
    try {
      // "wikipedia" contains "wip" but should not trigger
      writeFileSync(join(dir, "ok.ts"), 'const url = "https://wikipedia.org";\n');
      const result = runScanner(dir);
      expect(result.status).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("fails on CHANGEME", () => {
    const { dir, cleanup } = makeDir();
    try {
      writeFileSync(join(dir, "bad.ts"), 'const token = "CHANGEME";\n');
      const result = runScanner(dir);
      expect(result.status).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("fails on REPLACEME", () => {
    const { dir, cleanup } = makeDir();
    try {
      writeFileSync(join(dir, "bad.ts"), 'const secret = "REPLACEME";\n');
      const result = runScanner(dir);
      expect(result.status).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("fails on it.skip(", () => {
    const { dir, cleanup } = makeDir();
    try {
      writeFileSync(join(dir, "bad.test.ts"), "it.skip('broken test', () => {});\n");
      const result = runScanner(dir);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("it.skip");
    } finally {
      cleanup();
    }
  });

  it("fails on describe.skip(", () => {
    const { dir, cleanup } = makeDir();
    try {
      writeFileSync(join(dir, "bad.test.ts"), "describe.skip('suite', () => {});\n");
      const result = runScanner(dir);
      expect(result.status).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("fails on test.skip(", () => {
    const { dir, cleanup } = makeDir();
    try {
      writeFileSync(join(dir, "bad.test.ts"), "test.skip('broken', () => {});\n");
      const result = runScanner(dir);
      expect(result.status).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("fails on xit(", () => {
    const { dir, cleanup } = makeDir();
    try {
      writeFileSync(join(dir, "bad.test.ts"), "xit('old test', () => {});\n");
      const result = runScanner(dir);
      expect(result.status).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("reports file and line number in output", () => {
    const { dir, cleanup } = makeDir();
    try {
      writeFileSync(join(dir, "bad.ts"), "// line 1\nconst x = PLACEHOLDER;\n");
      const result = runScanner(dir);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("bad.ts:2");
    } finally {
      cleanup();
    }
  });

  it("scans nested subdirectories", () => {
    const { dir, cleanup } = makeDir();
    try {
      const subdir = join(dir, "nested", "deep");
      mkdirSync(subdir, { recursive: true });
      writeFileSync(join(subdir, "bad.ts"), "// FIXME\n");
      const result = runScanner(dir);
      expect(result.status).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("reports count of violations", () => {
    const { dir, cleanup } = makeDir();
    try {
      writeFileSync(join(dir, "bad.ts"), "// FIXME\n// HACK\n");
      const result = runScanner(dir);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("violation");
    } finally {
      cleanup();
    }
  });
});
