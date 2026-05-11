import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const REPO_ROOT = resolve(process.cwd());
const SCRIPT = join(REPO_ROOT, "scripts/check-inline-suppressions.mjs");

function runScript(dir: string): {
  status: number;
  stderr: string;
  stdout: string;
} {
  const result = spawnSync("node", [SCRIPT, dir], { encoding: "utf-8" });
  return {
    status: result.status ?? 1,
    stderr: result.stderr ?? "",
    stdout: result.stdout ?? "",
  };
}

function makeTmpProject(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "arbiter-inline-int-"));
  mkdirSync(join(dir, "src"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("inline suppression end-to-end (CANON-07)", () => {
  it("exits 0 on clean project with no suppressions", () => {
    const { dir, cleanup } = makeTmpProject();
    try {
      writeFileSync(join(dir, "src/index.ts"), "export const x = 1;\n");
      expect(runScript(dir).status).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("exits 0 on project with fully valid inline suppression", () => {
    const { dir, cleanup } = makeTmpProject();
    try {
      writeFileSync(
        join(dir, "src/index.ts"),
        '// arbiter-suppress(INV-04, until=2099-01-01, reason="DI field injected by Spring", owner=@luca)\nexport const x = 1;\n',
      );
      expect(runScript(dir).status).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("exits 1 when suppression has expired until= date", () => {
    const { dir, cleanup } = makeTmpProject();
    try {
      writeFileSync(
        join(dir, "src/index.ts"),
        '// arbiter-suppress(INV-04, until=2020-01-01, reason="DI field injected by Spring", owner=@luca)\nexport const x = 1;\n',
      );
      const { status, stderr } = runScript(dir);
      expect(status).toBe(1);
      expect(stderr).toContain("expired");
    } finally {
      cleanup();
    }
  });

  it("exits 1 when suppression is missing the reason field", () => {
    const { dir, cleanup } = makeTmpProject();
    try {
      writeFileSync(
        join(dir, "src/index.ts"),
        "// arbiter-suppress(INV-04, until=2099-01-01, owner=@luca)\nexport const x = 1;\n",
      );
      const { status, stderr } = runScript(dir);
      expect(status).toBe(1);
      expect(stderr).toContain("reason");
    } finally {
      cleanup();
    }
  });

  it("exits 1 when suppression has reason shorter than 10 chars", () => {
    const { dir, cleanup } = makeTmpProject();
    try {
      writeFileSync(
        join(dir, "src/index.ts"),
        '// arbiter-suppress(INV-04, until=2099-01-01, reason="too short", owner=@luca)\nexport const x = 1;\n',
      );
      const { status, stderr } = runScript(dir);
      expect(status).toBe(1);
      expect(stderr).toContain("reason");
    } finally {
      cleanup();
    }
  });

  it("exits 1 when suppression uses unknown invariant ID", () => {
    const { dir, cleanup } = makeTmpProject();
    try {
      writeFileSync(
        join(dir, "src/index.ts"),
        '// arbiter-suppress(INV-999, until=2099-01-01, reason="DI field injected by Spring", owner=@luca)\nexport const x = 1;\n',
      );
      const { status, stderr } = runScript(dir);
      expect(status).toBe(1);
      expect(stderr).toContain("INV-999");
    } finally {
      cleanup();
    }
  });

  it("exits 0 with 30-day warning when suppression expires soon, still valid", () => {
    const { dir, cleanup } = makeTmpProject();
    try {
      const soon = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      writeFileSync(
        join(dir, "src/index.ts"),
        `// arbiter-suppress(INV-04, until=${soon}, reason="DI field injected by Spring", owner=@luca)\nexport const x = 1;\n`,
      );
      const { status, stderr } = runScript(dir);
      expect(status).toBe(0);
      expect(stderr).toContain("expir");
    } finally {
      cleanup();
    }
  });

  it("scans .mjs files in addition to .ts files", () => {
    const { dir, cleanup } = makeTmpProject();
    try {
      writeFileSync(
        join(dir, "src/helper.mjs"),
        '// arbiter-suppress(INV-04, until=2099-01-01, reason="DI field injected by Spring", owner=@luca)\nexport const x = 1;\n',
      );
      expect(runScript(dir).status).toBe(0);
    } finally {
      cleanup();
    }
  });
});
