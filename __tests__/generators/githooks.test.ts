import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateGithooks } from "../../src/generators/githooks.js";
import { makeConfig } from "../helpers.js";
import { initGit } from "../helpers.js";

/**
 * CANON-05: every src/generators/*.ts file requires a corresponding
 * __tests__/generators/*.test.ts covering happy path, idempotency, and at
 * least one negative/edge case.
 */

describe("generateGithooks — happy path (typescript)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-githooks-gen-"));
    initGit(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns a result with files array", () => {
    const config = makeConfig(dir, { language: "typescript" });
    const result = generateGithooks(config);
    expect(Array.isArray(result.files)).toBe(true);
  });

  it("emits exactly 3 files (pre-commit, pre-push, commit-msg) for typescript", () => {
    const config = makeConfig(dir, { language: "typescript" });
    const result = generateGithooks(config);
    expect(result.files).toHaveLength(3);
  });

  it("includes .githooks/pre-commit in results", () => {
    const config = makeConfig(dir, { language: "typescript" });
    const result = generateGithooks(config);
    const paths = result.files.map((f) => f.path);
    expect(paths.some((p) => p.endsWith(join(".githooks", "pre-commit")))).toBe(
      true,
    );
  });

  it("includes .githooks/pre-push in results", () => {
    const config = makeConfig(dir, { language: "typescript" });
    const result = generateGithooks(config);
    const paths = result.files.map((f) => f.path);
    expect(paths.some((p) => p.endsWith(join(".githooks", "pre-push")))).toBe(
      true,
    );
  });

  it("includes .githooks/commit-msg in results", () => {
    const config = makeConfig(dir, { language: "typescript" });
    const result = generateGithooks(config);
    const paths = result.files.map((f) => f.path);
    expect(paths.some((p) => p.endsWith(join(".githooks", "commit-msg")))).toBe(
      true,
    );
  });

  it("does NOT include scripts/setup-hooks.sh for typescript", () => {
    const config = makeConfig(dir, { language: "typescript" });
    const result = generateGithooks(config);
    const paths = result.files.map((f) => f.path);
    expect(paths.some((p) => p.includes("setup-hooks.sh"))).toBe(false);
  });

  it("pre-commit hook file contains L1 gate invocation", () => {
    const config = makeConfig(dir, { language: "typescript" });
    generateGithooks(config);
    const content = readFileSync(join(dir, ".githooks", "pre-commit"), "utf-8");
    expect(content).toContain("node scripts/check-all.mjs L1");
  });

  it("pre-push hook file contains L2 gate invocation", () => {
    const config = makeConfig(dir, { language: "typescript" });
    generateGithooks(config);
    const content = readFileSync(join(dir, ".githooks", "pre-push"), "utf-8");
    expect(content).toContain("node scripts/check-all.mjs L2");
  });

  it("hooks are written with action 'created' on fresh directory", () => {
    const config = makeConfig(dir, { language: "typescript" });
    const result = generateGithooks(config);
    expect(result.files.every((f) => f.action === "created")).toBe(true);
  });
});

// ─── Idempotency ─────────────────────────────────────────────────────────────

describe("generateGithooks — idempotency", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-githooks-idem-"));
    initGit(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("second call returns 'skipped' for all hook files", () => {
    const config = makeConfig(dir, { language: "typescript" });
    generateGithooks(config);
    const second = generateGithooks(config);
    expect(second.files.every((f) => f.action === "skipped")).toBe(true);
  });

  it("pre-commit content is byte-identical after two runs", () => {
    const config = makeConfig(dir, { language: "typescript" });
    generateGithooks(config);
    const first = readFileSync(join(dir, ".githooks", "pre-commit"), "utf-8");
    generateGithooks(config);
    const second = readFileSync(join(dir, ".githooks", "pre-commit"), "utf-8");
    expect(second).toBe(first);
  });

  it("pre-push content is byte-identical after two runs", () => {
    const config = makeConfig(dir, { language: "typescript" });
    generateGithooks(config);
    const first = readFileSync(join(dir, ".githooks", "pre-push"), "utf-8");
    generateGithooks(config);
    const second = readFileSync(join(dir, ".githooks", "pre-push"), "utf-8");
    expect(second).toBe(first);
  });

  it("package.json prepare is not duplicated on second run (typescript)", () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "idem-test", scripts: {} }, null, 2) + "\n",
      "utf-8",
    );
    const config = makeConfig(dir, { language: "typescript" });
    generateGithooks(config);
    generateGithooks(config);
    const pkg = JSON.parse(
      readFileSync(join(dir, "package.json"), "utf-8"),
    ) as {
      scripts: Record<string, string>;
    };
    const matches =
      pkg.scripts.prepare?.match(/git config core\.hooksPath \.githooks/g) ??
      [];
    expect(matches).toHaveLength(1);
  });
});

// ─── Edge case: non-TS stack ──────────────────────────────────────────────────

describe("generateGithooks — edge case (non-typescript stack)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-githooks-nonts-"));
    initGit(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("rust: includes scripts/setup-hooks.sh in result files", () => {
    const config = makeConfig(dir, { language: "rust", buildTool: "cargo" });
    const result = generateGithooks(config);
    const paths = result.files.map((f) => f.path);
    expect(paths.some((p) => p.includes("setup-hooks.sh"))).toBe(true);
  });

  it("rust: scripts/setup-hooks.sh exists on disk", () => {
    const config = makeConfig(dir, { language: "rust", buildTool: "cargo" });
    generateGithooks(config);
    expect(existsSync(join(dir, "scripts", "setup-hooks.sh"))).toBe(true);
  });

  it("rust: does NOT modify package.json — file is unchanged if pre-existing", () => {
    const original =
      JSON.stringify({ name: "rust-test", scripts: {} }, null, 2) + "\n";
    writeFileSync(join(dir, "package.json"), original, "utf-8");

    const config = makeConfig(dir, { language: "rust", buildTool: "cargo" });
    generateGithooks(config);

    const after = readFileSync(join(dir, "package.json"), "utf-8");
    expect(after).toBe(original);
  });

  it("rust: pre-commit does NOT include rsync block", () => {
    const config = makeConfig(dir, { language: "rust", buildTool: "cargo" });
    generateGithooks(config);
    const content = readFileSync(join(dir, ".githooks", "pre-commit"), "utf-8");
    expect(content).not.toContain("rsync");
  });

  it("java: includes scripts/setup-hooks.sh in result files", () => {
    const config = makeConfig(dir, {
      language: "java",
      buildTool: "gradle",
    });
    const result = generateGithooks(config);
    const paths = result.files.map((f) => f.path);
    expect(paths.some((p) => p.includes("setup-hooks.sh"))).toBe(true);
  });
});
