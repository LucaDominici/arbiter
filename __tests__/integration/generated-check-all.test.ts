import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, cpSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { generateCheckAll } from "../../src/generators/check-all.js";
import { makeConfig } from "../helpers.js";

// L2-only: requires cargo, npm, and full toolchains.
const L2 = process.env.VITEST_L2 === "1";

function copyFixture(name: string): string {
  const src = resolve(`__tests__/fixtures/real-projects/${name}`);
  const dir = mkdtempSync(join(tmpdir(), `arbiter-gate-${name}-`));
  cpSync(src, dir, { recursive: true });
  return dir;
}

function initGit(dir: string): void {
  execFileSync("git", ["init", "-b", "main"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "ci@arbiter.test"], {
    cwd: dir,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.name", "Arbiter CI"], {
    cwd: dir,
    stdio: "ignore",
  });
  execFileSync("git", ["add", "-A"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "chore: fixture init", "--no-verify"], {
    cwd: dir,
    stdio: "ignore",
  });
}

function runGate(dir: string): { status: number; output: string } {
  const scriptPath = join(dir, "scripts", "check-all.mjs");
  expect(
    existsSync(scriptPath),
    `check-all.mjs not generated at ${scriptPath}`,
  ).toBe(true);
  const r = spawnSync("node", [scriptPath, "L1"], {
    encoding: "utf-8",
    cwd: dir,
    timeout: 120_000,
    env: { ...process.env, CI: "true" },
  });
  return { status: r.status ?? 1, output: (r.stdout ?? "") + (r.stderr ?? "") };
}

describe.skipIf(!L2)("generated check-all.mjs L1 execution (#172)", () => {
  describe("Rust library fixture", () => {
    let dir: string;

    it("generates check-all.mjs and runs L1 gate with exit 0", () => {
      dir = copyFixture("rust-library");
      initGit(dir);
      generateCheckAll(
        makeConfig(dir, {
          language: "rust",
          buildTool: "cargo",
          governanceLevel: "L1",
          enableSecurityScanning: false,
        }),
      );
      const { status, output } = runGate(dir);
      if (status !== 0) {
        console.error("Gate output:\n", output);
      }
      expect(status).toBe(0);
      rmSync(dir, { recursive: true, force: true });
    });
  });

  describe("TypeScript library fixture", () => {
    let dir: string;

    it("generates check-all.mjs and runs L1 gate with exit 0", () => {
      dir = copyFixture("ts-library");
      initGit(dir);
      // Install devDeps so tsc/eslint/vitest are available
      execFileSync("npm", ["install", "--silent"], {
        cwd: dir,
        stdio: "ignore",
        timeout: 120_000,
      });
      generateCheckAll(
        makeConfig(dir, {
          language: "typescript",
          buildTool: "npm",
          governanceLevel: "L1",
          enableSecurityScanning: false,
        }),
      );
      const { status, output } = runGate(dir);
      if (status !== 0) {
        console.error("Gate output:\n", output);
      }
      expect(status).toBe(0);
      rmSync(dir, { recursive: true, force: true });
    });
  });

  describe("Java library fixture", () => {
    let dir: string;
    const hasJava = Boolean(
      process.env.JAVA_HOME ||
      (() => {
        const r = spawnSync("java", ["-version"], { encoding: "utf-8" });
        return r.status === 0;
      })(),
    );

    it.skipIf(!hasJava)(
      "generates check-all.mjs and runs L1 gate with exit 0",
      () => {
        dir = copyFixture("java-library-gradle");
        initGit(dir);
        generateCheckAll(
          makeConfig(dir, {
            language: "java",
            buildTool: "gradle",
            governanceLevel: "L1",
            enableSecurityScanning: false,
          }),
        );
        const { status, output } = runGate(dir);
        if (status !== 0) {
          console.error("Gate output:\n", output);
        }
        expect(status).toBe(0);
        rmSync(dir, { recursive: true, force: true });
      },
    );
  });
});

// Smoke test (always runs, L1): just verifies the generated file is valid JS.
describe("generated check-all.mjs syntax (#172 smoke)", () => {
  let dir: string;

  it("generated Rust check-all.mjs has no syntax errors", () => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-gate-smoke-"));
    generateCheckAll(
      makeConfig(dir, {
        language: "rust",
        buildTool: "cargo",
        governanceLevel: "L1",
        enableSecurityScanning: false,
      }),
    );
    const scriptPath = join(dir, "scripts", "check-all.mjs");
    const content = readFileSync(scriptPath, "utf-8");
    const r = spawnSync("node", ["--check", scriptPath], { encoding: "utf-8" });
    expect(r.status, `Syntax error: ${r.stderr}`).toBe(0);
    expect(content).toContain("runCheck");
    rmSync(dir, { recursive: true, force: true });
  });

  it("generated TypeScript check-all.mjs has no syntax errors", () => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-gate-smoke-"));
    generateCheckAll(
      makeConfig(dir, {
        language: "typescript",
        buildTool: "npm",
        governanceLevel: "L1",
        enableSecurityScanning: false,
      }),
    );
    const scriptPath = join(dir, "scripts", "check-all.mjs");
    const r = spawnSync("node", ["--check", scriptPath], { encoding: "utf-8" });
    expect(r.status, `Syntax error: ${r.stderr}`).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });
});
