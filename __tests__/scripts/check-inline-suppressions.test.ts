import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const SCRIPT = resolve("scripts/check-inline-suppressions.mjs");

function runScanner(dir: string): {
  status: number;
  stdout: string;
  stderr: string;
} {
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
  const dir = mkdtempSync(join(tmpdir(), "inline-suppress-test-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const VALID_DIRECTIVE =
  '// arbiter-suppress(INV-04, until=2099-01-01, reason="DI field injected by Spring", owner=@luca)';

describe("check-inline-suppressions.mjs", () => {
  it("exits 0 on a clean file with no directives", () => {
    const { dir, cleanup } = makeDir();
    try {
      writeFileSync(
        join(dir, "clean.ts"),
        'export function hello(): string { return "world"; }\n',
      );
      expect(runScanner(dir).status).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("exits 0 on empty directory", () => {
    const { dir, cleanup } = makeDir();
    try {
      expect(runScanner(dir).status).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("exits 0 on a valid directive with future until=", () => {
    const { dir, cleanup } = makeDir();
    try {
      writeFileSync(
        join(dir, "valid.ts"),
        `${VALID_DIRECTIVE}\nconst x: any = 1;\n`,
      );
      expect(runScanner(dir).status).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("exits 1 on an expired directive (until= in the past)", () => {
    const { dir, cleanup } = makeDir();
    try {
      writeFileSync(
        join(dir, "expired.ts"),
        '// arbiter-suppress(INV-04, until=2020-01-01, reason="DI field injected by Spring", owner=@luca)\nconst x: any = 1;\n',
      );
      const { status, stderr } = runScanner(dir);
      expect(status).toBe(1);
      expect(stderr).toMatch(/expired/i);
    } finally {
      cleanup();
    }
  });

  it("exits 0 but warns when directive expires within 30 days", () => {
    const { dir, cleanup } = makeDir();
    try {
      const soon = new Date();
      soon.setDate(soon.getDate() + 10);
      const until = soon.toISOString().slice(0, 10);
      writeFileSync(
        join(dir, "expiring.ts"),
        `// arbiter-suppress(INV-04, until=${until}, reason="DI field injected by Spring", owner=@luca)\nconst x: any = 1;\n`,
      );
      const { status, stderr } = runScanner(dir);
      expect(status).toBe(0);
      expect(stderr).toMatch(/expires in/i);
    } finally {
      cleanup();
    }
  });

  it("exits 1 when until= field is missing", () => {
    const { dir, cleanup } = makeDir();
    try {
      writeFileSync(
        join(dir, "missing-until.ts"),
        '// arbiter-suppress(INV-04, reason="DI field injected by Spring", owner=@luca)\nconst x: any = 1;\n',
      );
      const { status, stderr } = runScanner(dir);
      expect(status).toBe(1);
      expect(stderr).toMatch(/missing.*until/i);
    } finally {
      cleanup();
    }
  });

  it("exits 1 when reason= field is missing", () => {
    const { dir, cleanup } = makeDir();
    try {
      writeFileSync(
        join(dir, "missing-reason.ts"),
        "// arbiter-suppress(INV-04, until=2099-01-01, owner=@luca)\nconst x: any = 1;\n",
      );
      const { status, stderr } = runScanner(dir);
      expect(status).toBe(1);
      expect(stderr).toMatch(/missing.*reason/i);
    } finally {
      cleanup();
    }
  });

  it("exits 1 when owner= field is missing", () => {
    const { dir, cleanup } = makeDir();
    try {
      writeFileSync(
        join(dir, "missing-owner.ts"),
        '// arbiter-suppress(INV-04, until=2099-01-01, reason="DI field injected by Spring")\nconst x: any = 1;\n',
      );
      const { status, stderr } = runScanner(dir);
      expect(status).toBe(1);
      expect(stderr).toMatch(/missing.*owner/i);
    } finally {
      cleanup();
    }
  });

  it("exits 1 when reason is shorter than 10 characters", () => {
    const { dir, cleanup } = makeDir();
    try {
      writeFileSync(
        join(dir, "short-reason.ts"),
        '// arbiter-suppress(INV-04, until=2099-01-01, reason="Short", owner=@luca)\nconst x: any = 1;\n',
      );
      const { status, stderr } = runScanner(dir);
      expect(status).toBe(1);
      expect(stderr).toMatch(/reason must be at least/i);
    } finally {
      cleanup();
    }
  });

  it("exits 1 when INV-NN is not in the catalog (unknown ID)", () => {
    const { dir, cleanup } = makeDir();
    try {
      writeFileSync(
        join(dir, "unknown-inv.ts"),
        '// arbiter-suppress(INV-99, until=2099-01-01, reason="DI field injected by Spring", owner=@luca)\nconst x: any = 1;\n',
      );
      const { status, stderr } = runScanner(dir);
      expect(status).toBe(1);
      expect(stderr).toMatch(/unknown.*INV-99/i);
    } finally {
      cleanup();
    }
  });

  it("exits 1 for malformed directive (no key=value form in args)", () => {
    const { dir, cleanup } = makeDir();
    try {
      writeFileSync(
        join(dir, "malformed.ts"),
        "// arbiter-suppress(INV-04 2099-01-01 DI field owner=@luca)\nconst x: any = 1;\n",
      );
      const { status, stderr } = runScanner(dir);
      expect(status).toBe(1);
      expect(stderr).toMatch(/missing|malformed|invalid/i);
    } finally {
      cleanup();
    }
  });

  it("exits 1 for until= with invalid date format", () => {
    const { dir, cleanup } = makeDir();
    try {
      writeFileSync(
        join(dir, "bad-date.ts"),
        '// arbiter-suppress(INV-04, until=never, reason="DI field injected by Spring", owner=@luca)\nconst x: any = 1;\n',
      );
      const { status, stderr } = runScanner(dir);
      expect(status).toBe(1);
      expect(stderr).toMatch(/invalid.*until|invalid.*date/i);
    } finally {
      cleanup();
    }
  });

  it("scans nested subdirectories", () => {
    const { dir, cleanup } = makeDir();
    try {
      const subDir = join(dir, "src", "deep");
      mkdirSync(subDir, { recursive: true });
      writeFileSync(
        join(subDir, "nested.ts"),
        '// arbiter-suppress(INV-99, until=2099-01-01, reason="DI field injected by Spring", owner=@luca)\nconst x: any = 1;\n',
      );
      const { status, stderr } = runScanner(dir);
      expect(status).toBe(1);
      expect(stderr).toMatch(/INV-99/);
    } finally {
      cleanup();
    }
  });

  it("reports file and line number in output", () => {
    const { dir, cleanup } = makeDir();
    try {
      writeFileSync(
        join(dir, "located.ts"),
        '// line 1\n// arbiter-suppress(INV-04, until=2020-01-01, reason="DI field injected by Spring", owner=@luca)\nconst x: any = 1;\n',
      );
      const { status, stderr } = runScanner(dir);
      expect(status).toBe(1);
      expect(stderr).toContain("located.ts");
    } finally {
      cleanup();
    }
  });

  it("exits 0 on a .mjs file with a valid directive", () => {
    const { dir, cleanup } = makeDir();
    try {
      writeFileSync(
        join(dir, "util.mjs"),
        `${VALID_DIRECTIVE}\nexport const x = 1;\n`,
      );
      expect(runScanner(dir).status).toBe(0);
    } finally {
      cleanup();
    }
  });
});
