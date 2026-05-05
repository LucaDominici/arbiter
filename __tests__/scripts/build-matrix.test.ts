import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const SCRIPT = resolve("scripts/build-matrix.mjs");

function run(fixturesDir: string): {
  status: number;
  stdout: string;
  stderr: string;
} {
  const r = spawnSync("node", [SCRIPT, `--fixtures-dir=${fixturesDir}`], {
    encoding: "utf-8",
    cwd: resolve("."),
  });
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

function makeTemp(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "build-matrix-test-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function addFixture(
  fixturesDir: string,
  name: string,
  manifest: Record<string, unknown>,
): void {
  const dir = join(fixturesDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
}

describe("build-matrix.mjs", () => {
  it("emits a matrix= output line with valid JSON", () => {
    const { dir, cleanup } = makeTemp();
    try {
      const fixturesDir = join(dir, "fixtures");
      addFixture(fixturesDir, "ts-lib", {
        language: "typescript",
        archetype: "library",
        levels: ["L1", "L2"],
      });
      const result = run(fixturesDir);
      expect(result.status).toBe(0);
      const line = result.stdout
        .split("\n")
        .find((l) => l.startsWith("matrix="));
      expect(line).toBeDefined();
      const json = JSON.parse(line!.replace("matrix=", ""));
      expect(json).toHaveProperty("include");
    } finally {
      cleanup();
    }
  });

  it("fans out one entry per fixture × level", () => {
    const { dir, cleanup } = makeTemp();
    try {
      const fixturesDir = join(dir, "fixtures");
      addFixture(fixturesDir, "ts-lib", {
        language: "typescript",
        archetype: "library",
        levels: ["L1", "L2"],
      });
      addFixture(fixturesDir, "rust-lib", {
        language: "rust",
        archetype: "library",
        levels: ["L1"],
      });
      const result = run(fixturesDir);
      const line = result.stdout
        .split("\n")
        .find((l) => l.startsWith("matrix="));
      const json = JSON.parse(line!.replace("matrix=", ""));
      // ts-lib × 2 levels + rust-lib × 1 level = 3 entries
      expect(json.include).toHaveLength(3);
    } finally {
      cleanup();
    }
  });

  it("each entry has fixture, language, level, archetype fields", () => {
    const { dir, cleanup } = makeTemp();
    try {
      const fixturesDir = join(dir, "fixtures");
      addFixture(fixturesDir, "ts-lib", {
        language: "typescript",
        archetype: "library",
        levels: ["L1"],
      });
      const result = run(fixturesDir);
      const line = result.stdout
        .split("\n")
        .find((l) => l.startsWith("matrix="));
      const json = JSON.parse(line!.replace("matrix=", ""));
      const entry = json.include[0] as Record<string, unknown>;
      expect(entry).toHaveProperty("fixture", "ts-lib");
      expect(entry).toHaveProperty("language", "typescript");
      expect(entry).toHaveProperty("archetype", "library");
      expect(entry).toHaveProperty("level", "L1");
    } finally {
      cleanup();
    }
  });

  it("includes buildTool field when present in manifest", () => {
    const { dir, cleanup } = makeTemp();
    try {
      const fixturesDir = join(dir, "fixtures");
      addFixture(fixturesDir, "java-lib", {
        language: "java",
        archetype: "library",
        buildTool: "gradle",
        levels: ["L1"],
      });
      const result = run(fixturesDir);
      const line = result.stdout
        .split("\n")
        .find((l) => l.startsWith("matrix="));
      const json = JSON.parse(line!.replace("matrix=", ""));
      expect(json.include[0]).toHaveProperty("buildTool", "gradle");
    } finally {
      cleanup();
    }
  });

  it("exits 1 with empty fixtures dir (no matrix entries produced)", () => {
    const { dir, cleanup } = makeTemp();
    try {
      const fixturesDir = join(dir, "fixtures");
      mkdirSync(fixturesDir, { recursive: true });
      const result = run(fixturesDir);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("no matrix entries produced");
    } finally {
      cleanup();
    }
  });

  it("skips fixture dirs without manifest.json (with a warning)", () => {
    const { dir, cleanup } = makeTemp();
    try {
      const fixturesDir = join(dir, "fixtures");
      mkdirSync(join(fixturesDir, "no-manifest"), { recursive: true });
      addFixture(fixturesDir, "ts-lib", {
        language: "typescript",
        archetype: "library",
        levels: ["L1"],
      });
      const result = run(fixturesDir);
      expect(result.status).toBe(0);
      const line = result.stdout
        .split("\n")
        .find((l) => l.startsWith("matrix="));
      const json = JSON.parse(line!.replace("matrix=", ""));
      expect(json.include).toHaveLength(1);
    } finally {
      cleanup();
    }
  });

  it("produces 21 entries for the real fixture set", () => {
    const fixturesDir = resolve("__tests__/fixtures/real-projects");
    const result = run(fixturesDir);
    expect(result.status).toBe(0);
    const line = result.stdout.split("\n").find((l) => l.startsWith("matrix="));
    const json = JSON.parse(line!.replace("matrix=", ""));
    // 9 original fixtures × 2 levels each = 18; multi-lane-fe-be adds 3 levels = 21
    expect(json.include).toHaveLength(21);
  });
});
