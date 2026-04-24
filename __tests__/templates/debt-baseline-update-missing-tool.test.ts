import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { renderTemplate } from "../../src/utils/render.js";
import { makeConfig } from "../helpers.js";
import { computeMetricsProfile } from "../../src/generators/debt-ratchet.js";
import type { ProjectConfig } from "../../src/wizard/types.js";

// Render the capture template for typescript and execute it against a
// controlled fake `debt-lib.mjs` that returns a predetermined `collected`
// object. Lets us verify --update semantics end-to-end without touching real
// tools.
function renderCapture(overrides: Partial<ProjectConfig> = {}): string {
  const config = makeConfig("/tmp/test", {
    language: "typescript",
    enableDebtGates: true,
    ...overrides,
  });
  const metricsProfile = computeMetricsProfile(config);
  const data = { ...config, metricsProfile } as unknown as Record<
    string,
    unknown
  >;
  return renderTemplate("scripts/capture-debt-baseline.mjs.ejs", data);
}

function writeFakeDebtLib(dir: string, collected: Record<string, unknown>) {
  const src = `export function collectMetrics(_cwd) { return ${JSON.stringify(collected)}; }
export function countTodos(_cwd) { return 0; }
export function getCommit(_cwd) { return 'testcommit'; }
`;
  writeFileSync(join(dir, "scripts", "debt-lib.mjs"), src, "utf-8");
}

function runCapture(dir: string, args: string[] = []) {
  const r = spawnSync(
    "node",
    [join(dir, "scripts", "capture-debt-baseline.mjs"), ...args],
    { cwd: dir, encoding: "utf-8" },
  );
  if (r.status !== 0) {
    throw new Error(
      `capture script failed (exit ${r.status}):\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`,
    );
  }
  return r;
}

function readBaseline(dir: string) {
  return JSON.parse(
    readFileSync(join(dir, "scripts", "debt-baseline.json"), "utf-8"),
  );
}

describe("capture-debt-baseline --update: missing-tool preservation (#126)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-debt-baseline-"));
    mkdirSync(join(dir, "scripts"), { recursive: true });
    writeFileSync(
      join(dir, "scripts", "capture-debt-baseline.mjs"),
      renderCapture(),
      "utf-8",
    );
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("preserves prior metrics for tools absent from `collected`", () => {
    // tool_b was captured in a prior run (e.g. on a CI machine with eslint),
    // but the current machine lacks eslint — `collected` only has tool_a.
    writeFileSync(
      join(dir, "scripts", "debt-baseline.json"),
      JSON.stringify({
        version: 2,
        metrics: {
          tool_a: { value: 50, unit: "percent", direction: "higher-is-better" },
          tool_b: { value: 3, unit: "count", direction: "lower-is-better" },
        },
      }),
      "utf-8",
    );
    writeFakeDebtLib(dir, {
      tool_a: { value: 60, unit: "percent", direction: "higher-is-better" },
    });

    runCapture(dir, ["--update"]);

    const after = readBaseline(dir);
    // tool_b preserved verbatim — this is the regression the fix addresses.
    expect(after.metrics.tool_b).toEqual({
      value: 3,
      unit: "count",
      direction: "lower-is-better",
    });
    // tool_a ratcheted upward (higher-is-better).
    expect(after.metrics.tool_a.value).toBe(60);
  });

  it("ratchet: keeps prior value when current is worse (higher-is-better)", () => {
    writeFileSync(
      join(dir, "scripts", "debt-baseline.json"),
      JSON.stringify({
        version: 2,
        metrics: {
          tool_a: { value: 90, unit: "percent", direction: "higher-is-better" },
        },
      }),
      "utf-8",
    );
    writeFakeDebtLib(dir, {
      tool_a: { value: 80, unit: "percent", direction: "higher-is-better" },
    });

    runCapture(dir, ["--update"]);

    const after = readBaseline(dir);
    expect(after.metrics.tool_a.value).toBe(90);
  });

  it("ratchet: keeps prior value when current is worse (lower-is-better)", () => {
    writeFileSync(
      join(dir, "scripts", "debt-baseline.json"),
      JSON.stringify({
        version: 2,
        metrics: {
          tool_a: { value: 2, unit: "count", direction: "lower-is-better" },
        },
      }),
      "utf-8",
    );
    writeFakeDebtLib(dir, {
      tool_a: { value: 5, unit: "count", direction: "lower-is-better" },
    });

    runCapture(dir, ["--update"]);

    const after = readBaseline(dir);
    expect(after.metrics.tool_a.value).toBe(2);
  });

  it("first run without --update writes only `collected` metrics (no prior baseline)", () => {
    writeFakeDebtLib(dir, {
      tool_a: { value: 70, unit: "percent", direction: "higher-is-better" },
    });

    runCapture(dir);

    const after = readBaseline(dir);
    expect(after.metrics.tool_a.value).toBe(70);
    expect(after.metrics).not.toHaveProperty("tool_b");
  });

  it("--update without an existing baseline file treats as first run", () => {
    writeFakeDebtLib(dir, {
      tool_a: { value: 70, unit: "percent", direction: "higher-is-better" },
    });

    runCapture(dir, ["--update"]);

    const after = readBaseline(dir);
    expect(after.metrics.tool_a.value).toBe(70);
  });

  it("--update with v1 baseline (no `metrics` key) behaves like first run", () => {
    writeFileSync(
      join(dir, "scripts", "debt-baseline.json"),
      JSON.stringify({ version: 1, todoCount: 7 }),
      "utf-8",
    );
    writeFakeDebtLib(dir, {
      tool_a: { value: 70, unit: "percent", direction: "higher-is-better" },
    });

    runCapture(dir, ["--update"]);

    const after = readBaseline(dir);
    expect(after.version).toBe(2);
    expect(after.metrics.tool_a.value).toBe(70);
    // The v1 top-level `todoCount: 7` is NOT carried forward as a metric —
    // only keys under `existing.metrics` are seeded, and v1 has no such key.
    // The fresh todoCount metric comes from the live countTodos() collector.
    expect(after.metrics.todoCount.value).toBe(0);
  });

  it("direction change between runs overwrites with current (no silent unit mix)", () => {
    writeFileSync(
      join(dir, "scripts", "debt-baseline.json"),
      JSON.stringify({
        version: 2,
        metrics: {
          tool_a: { value: 90, unit: "ratio", direction: "higher-is-better" },
        },
      }),
      "utf-8",
    );
    writeFakeDebtLib(dir, {
      tool_a: { value: 5, unit: "count", direction: "lower-is-better" },
    });

    runCapture(dir, ["--update"]);

    const after = readBaseline(dir);
    expect(after.metrics.tool_a).toEqual({
      value: 5,
      unit: "count",
      direction: "lower-is-better",
    });
  });

  it("malformed baseline file produces error message including filename", () => {
    writeFileSync(
      join(dir, "scripts", "debt-baseline.json"),
      "{ this is not valid json",
      "utf-8",
    );
    writeFakeDebtLib(dir, {
      tool_a: { value: 70, unit: "percent", direction: "higher-is-better" },
    });

    const r = spawnSync(
      "node",
      [join(dir, "scripts", "capture-debt-baseline.mjs"), "--update"],
      { cwd: dir, encoding: "utf-8" },
    );
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("Malformed baseline");
    expect(r.stderr).toContain("debt-baseline.json");
  });
});
