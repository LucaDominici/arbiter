import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  mkdirSync,
  readdirSync,
  chmodSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { makeConfig } from "../helpers.js";
import { runGenerators } from "../../src/commands/init.js";
import type { DebtBaselineV2 } from "../../src/generators/debt-ratchet.js";

const RUN_E2E = process.env["RUN_E2E"] === "1";

const FIXTURE_DIR = new URL("../fixtures/brownfield-java", import.meta.url)
  .pathname;

/** Recursively copy src directory into dst. */
function copyDir(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name);
    const dstPath = join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, dstPath);
    } else {
      copyFileSync(srcPath, dstPath);
    }
  }
}

function initTestGit(dir: string): void {
  execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@arbiter.dev"], {
    cwd: dir,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.name", "Arbiter Test"], {
    cwd: dir,
    stdio: "ignore",
  });
}

// ─── Schema v1 migration test (no Gradle needed) ──────────────────────────────
// Validates that debt-report.mjs detects a v1 baseline, prints a migration hint,
// and exits 0 (soft — same as no baseline). Does not need the full Java toolchain.

describe("debt-report.mjs — v1 baseline migration", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-schema-test-"));
    initTestGit(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("prints migration hint and exits 0 for a v1 baseline", () => {
    const config = makeConfig(dir, {
      language: "java",
      buildTool: "gradle",
      archetype: "backend-web-db",
      enableDebtGates: true,
      useGitHub: false,
    });
    runGenerators(config);

    // Place a hand-crafted v1 baseline (pre-schema-v2 format).
    const v1Baseline = {
      version: 1,
      capturedAt: "2025-01-01T00:00:00Z",
      commit: "abc1234",
      metrics: {
        coverage: 65,
        complexityViolations: 0,
        deadCode: 0,
        todoCount: 2,
      },
    };
    writeFileSync(
      join(dir, "scripts/debt-baseline.json"),
      JSON.stringify(v1Baseline, null, 2),
      "utf-8",
    );

    const result = spawnSync("node", ["scripts/debt-report.mjs", "--gate"], {
      cwd: dir,
      encoding: "utf-8",
    });

    expect(result.status).toBe(0); // soft exit — v1 never fails the gate
    const output = (result.stdout ?? "") + (result.stderr ?? "");
    expect(output).toContain("v1");
    expect(output).toContain("migrate");
  });
});

// ─── Full E2E test (requires system Gradle + PMD, gated behind RUN_E2E=1) ─────
// Flow:
//   1. Copy fixture to temp dir → generate scripts → capture N0.
//   2. Add Stanza6 (→ N0+1)   → debt-report --gate exits 1 (regression).
//   3. Remove Stanza4+5 (→ N0-1) → debt-report --gate exits 0 (improvement).
//   4. capture --update        → baseline ratchets to N0-1.
// Violations are relative deltas — never absolute counts — so the test remains
// valid as long as each stanza file contains exactly one EmptyCatchBlock.

describe.skipIf(!RUN_E2E)("brownfield Java baseline E2E", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-brownfield-e2e-"));
    copyDir(FIXTURE_DIR, dir);
    chmodSync(join(dir, "gradlew"), 0o755);
    initTestGit(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("captures N0, gates on regression, passes on improvement, ratchets on update", () => {
    const config = makeConfig(dir, {
      language: "java",
      buildTool: "gradle",
      archetype: "backend-web-db",
      enableDebtGates: true,
      useGitHub: false,
    });
    runGenerators(config);

    // ── Step 1: Capture baseline N0 ────────────────────────────────────────────
    execFileSync("node", ["scripts/capture-debt-baseline.mjs"], {
      cwd: dir,
      stdio: "pipe",
      timeout: 300_000, // allow time for Gradle + PMD download on first run
    });

    const baseline0 = JSON.parse(
      readFileSync(join(dir, "scripts/debt-baseline.json"), "utf-8"),
    ) as unknown as DebtBaselineV2;

    expect(baseline0.version).toBe(2);
    expect(typeof baseline0.metrics["pmdViolations"]).toBe("object");

    const n0 = baseline0.metrics["pmdViolations"]?.value ?? 0;
    expect(n0).toBeGreaterThan(0); // seeded stanzas produced violations
    expect(n0).toBe(5); // exactly 5 stanza files × 1 EmptyCatchBlock each

    // ── Step 2: Add Stanza6 → regression (N0+1) ────────────────────────────────
    writeFileSync(
      join(dir, "src/main/java/com/example/Stanza6.java"),
      [
        "package com.example;",
        "// brownfield-test seeded violation: EmptyCatchBlock (one per file)",
        "public class Stanza6 {",
        "    public void method() {",
        "        try {",
        "            doWork();",
        "        } catch (Exception e) {",
        "        }",
        "    }",
        "    private void doWork() {}",
        "}",
        "",
      ].join("\n"),
      "utf-8",
    );

    const gate1 = spawnSync("node", ["scripts/debt-report.mjs", "--gate"], {
      cwd: dir,
      encoding: "utf-8",
      timeout: 300_000,
    });
    expect(gate1.status).toBe(1); // gate fails on regression
    const gate1Output = (gate1.stdout ?? "") + (gate1.stderr ?? "");
    expect(gate1Output).toContain("pmdViolations");

    // ── Step 3: Remove Stanza4+5 → net N0-1, gate passes ─────────────────────
    // State: Stanza1+2+3+6 present (4 violations) vs baseline N0=5 → improvement
    unlinkSync(join(dir, "src/main/java/com/example/Stanza4.java"));
    unlinkSync(join(dir, "src/main/java/com/example/Stanza5.java"));

    const gate2 = spawnSync("node", ["scripts/debt-report.mjs", "--gate"], {
      cwd: dir,
      encoding: "utf-8",
      timeout: 300_000,
    });
    expect(gate2.status).toBe(0); // gate passes — current is better than baseline

    // ── Step 4: Ratchet baseline down to N0-1 ─────────────────────────────────
    execFileSync("node", ["scripts/capture-debt-baseline.mjs", "--update"], {
      cwd: dir,
      stdio: "pipe",
      timeout: 300_000,
    });

    const baselineUpdated = JSON.parse(
      readFileSync(join(dir, "scripts/debt-baseline.json"), "utf-8"),
    ) as unknown as DebtBaselineV2;

    expect(baselineUpdated.metrics["pmdViolations"]?.value).toBe(n0 - 1);
  });
});
