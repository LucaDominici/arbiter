import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const SCRIPT = resolve("scripts/check-ci-alignment.mjs");

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runAligner(cwd: string): RunResult {
  const result = spawnSync("node", [SCRIPT], {
    encoding: "utf-8",
    cwd,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function makeFixtureDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "ci-align-test-"));
  mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
  mkdirSync(join(dir, "scripts"), { recursive: true });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Minimal aligned manifest: one node-script gate */
const MINIMAL_MANIFEST = `
function runCheck(name, cmd, args) {}
runCheck("my-check", "node", ["scripts/my-check.mjs"]);
`;

/** Minimal CI that runs the same script */
const MINIMAL_CI = `
name: CI
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: node scripts/my-check.mjs
`;

/** CI missing the gate that is in the manifest */
const CI_MISSING_GATE = `
name: CI
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: echo "nothing useful"
`;

/** CI with an extra gate not in the manifest */
const CI_EXTRA_GATE = `
name: CI
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: node scripts/my-check.mjs
      - run: node scripts/extra-check.mjs
`;

/** Manifest with an extra gate not in CI */
const MANIFEST_EXTRA_GATE = `
function runCheck(name, cmd, args) {}
runCheck("my-check", "node", ["scripts/my-check.mjs"]);
runCheck("extra-check", "node", ["scripts/extra-check.mjs"]);
`;

describe("check-ci-alignment.mjs", () => {
  it("exits 0 when manifest and CI are aligned (node script gates)", () => {
    const { dir, cleanup } = makeFixtureDir();
    try {
      writeFileSync(join(dir, "scripts", "check-all.mjs"), MINIMAL_MANIFEST);
      writeFileSync(join(dir, ".github", "workflows", "ci.yml"), MINIMAL_CI);
      const result = runAligner(dir);
      expect(result.status).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("exits 1 when a manifest gate is missing from CI", () => {
    const { dir, cleanup } = makeFixtureDir();
    try {
      writeFileSync(join(dir, "scripts", "check-all.mjs"), MINIMAL_MANIFEST);
      writeFileSync(
        join(dir, ".github", "workflows", "ci.yml"),
        CI_MISSING_GATE,
      );
      const result = runAligner(dir);
      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).toContain("manifest-only");
    } finally {
      cleanup();
    }
  });

  it("exits 1 when CI has a gate not in the manifest", () => {
    const { dir, cleanup } = makeFixtureDir();
    try {
      writeFileSync(join(dir, "scripts", "check-all.mjs"), MINIMAL_MANIFEST);
      writeFileSync(join(dir, ".github", "workflows", "ci.yml"), CI_EXTRA_GATE);
      const result = runAligner(dir);
      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).toContain("ci-only");
    } finally {
      cleanup();
    }
  });

  it("exits 1 when manifest has extra gate not in CI", () => {
    const { dir, cleanup } = makeFixtureDir();
    try {
      writeFileSync(join(dir, "scripts", "check-all.mjs"), MANIFEST_EXTRA_GATE);
      writeFileSync(join(dir, ".github", "workflows", "ci.yml"), MINIMAL_CI);
      const result = runAligner(dir);
      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).toContain("manifest-only");
    } finally {
      cleanup();
    }
  });

  it("skips infra steps (checkout, setup-node, npm ci)", () => {
    const { dir, cleanup } = makeFixtureDir();
    try {
      writeFileSync(join(dir, "scripts", "check-all.mjs"), MINIMAL_MANIFEST);
      const ciWithInfra = `
name: CI
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: node scripts/my-check.mjs
      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: results
          path: results/
`;
      writeFileSync(join(dir, ".github", "workflows", "ci.yml"), ciWithInfra);
      const result = runAligner(dir);
      expect(result.status).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("exits 0 on empty manifest and empty CI (no gates in either)", () => {
    const { dir, cleanup } = makeFixtureDir();
    try {
      writeFileSync(
        join(dir, "scripts", "check-all.mjs"),
        "function runCheck(n, c, a) {}\n",
      );
      writeFileSync(
        join(dir, ".github", "workflows", "ci.yml"),
        "name: CI\njobs:\n  ci:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n",
      );
      const result = runAligner(dir);
      expect(result.status).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("exits 0 on current arbiter repo (live integration test)", () => {
    const result = spawnSync("node", [SCRIPT], {
      encoding: "utf-8",
      cwd: resolve("."),
    });
    expect(result.status).toBe(0);
  });

  it("handles missing workflows directory gracefully (exits 0 — no CI gates = empty set)", () => {
    const { dir, cleanup } = makeFixtureDir();
    try {
      rmSync(join(dir, ".github"), { recursive: true });
      writeFileSync(
        join(dir, "scripts", "check-all.mjs"),
        "function runCheck(n, c, a) {}\n",
      );
      const result = runAligner(dir);
      expect(result.status).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("handles missing check-all.mjs gracefully (exits 1 with clear message)", () => {
    const { dir, cleanup } = makeFixtureDir();
    try {
      writeFileSync(join(dir, ".github", "workflows", "ci.yml"), MINIMAL_CI);
      // No check-all.mjs written
      const result = runAligner(dir);
      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).toMatch(/check-all\.mjs/i);
    } finally {
      cleanup();
    }
  });

  it("detects gates in block scalar CI steps (run: |)", () => {
    const { dir, cleanup } = makeFixtureDir();
    try {
      writeFileSync(join(dir, "scripts", "check-all.mjs"), MINIMAL_MANIFEST);
      const ciWithBlock = `
name: CI
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run check
        run: |
          node scripts/my-check.mjs
`;
      writeFileSync(join(dir, ".github", "workflows", "ci.yml"), ciWithBlock);
      const result = runAligner(dir);
      expect(result.status).toBe(0);
    } finally {
      cleanup();
    }
  });
});

describe("check-ci-alignment.mjs wiring in check-all.mjs", () => {
  it("is wired into the L1 block of check-all.mjs (#240)", () => {
    const content = readFileSync(resolve("scripts/check-all.mjs"), "utf-8");
    const l2BlockIdx = content.indexOf("// ─── L2/L3: Full checks");
    const ciAlignIdx = content.indexOf("check-ci-alignment.mjs");
    expect(ciAlignIdx).toBeGreaterThan(-1);
    expect(ciAlignIdx).toBeLessThan(l2BlockIdx);
  });
});
