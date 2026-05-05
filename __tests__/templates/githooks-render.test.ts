import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/utils/render.js";
import { makeConfig } from "../helpers.js";

/**
 * CANON-04: every .ejs template under src/templates/ must be asserted by at
 * least one test in __tests__/templates/ that renders the template and checks
 * concrete output strings.
 *
 * Covers: githooks/pre-commit.ejs, githooks/pre-push.ejs,
 *         githooks/commit-msg.ejs, githooks/setup-hooks.sh.ejs
 */

function tsConfig(): Record<string, unknown> {
  return makeConfig("/tmp/test-githooks", {
    language: "typescript",
    buildTool: "npm",
    projectName: "test-project",
  }) as unknown as Record<string, unknown>;
}

function rustConfig(): Record<string, unknown> {
  return makeConfig("/tmp/test-githooks", {
    language: "rust",
    buildTool: "cargo",
    projectName: "test-project",
  }) as unknown as Record<string, unknown>;
}

// ─── githooks/pre-commit.ejs ─────────────────────────────────────────────────

describe("githooks/pre-commit.ejs", () => {
  it("renders without EJS tag leaks for typescript", () => {
    const out = renderTemplate("githooks/pre-commit.ejs", tsConfig());
    expect(out).not.toContain("<%");
    expect(out).not.toContain("%>");
  });

  it("renders without EJS tag leaks for rust", () => {
    const out = renderTemplate("githooks/pre-commit.ejs", rustConfig());
    expect(out).not.toContain("<%");
    expect(out).not.toContain("%>");
  });

  it("typescript: invokes L1 gate", () => {
    const out = renderTemplate("githooks/pre-commit.ejs", tsConfig());
    expect(out).toContain("node scripts/check-all.mjs L1");
  });

  it("typescript: includes rsync workaround for # in path", () => {
    const out = renderTemplate("githooks/pre-commit.ejs", tsConfig());
    expect(out).toContain("rsync -a");
    expect(out).toContain('#"*');
  });

  it("typescript: includes mktemp for tmp dir creation", () => {
    const out = renderTemplate("githooks/pre-commit.ejs", tsConfig());
    expect(out).toContain("mktemp");
  });

  it("typescript: guards on node_modules presence", () => {
    const out = renderTemplate("githooks/pre-commit.ejs", tsConfig());
    expect(out).toContain("node_modules");
  });

  it("rust: invokes L1 gate", () => {
    const out = renderTemplate("githooks/pre-commit.ejs", rustConfig());
    expect(out).toContain("node scripts/check-all.mjs L1");
  });

  it("rust: does NOT include rsync block", () => {
    const out = renderTemplate("githooks/pre-commit.ejs", rustConfig());
    expect(out).not.toContain("rsync");
    expect(out).not.toContain("mktemp");
  });

  it("rust: guards on node command availability", () => {
    const out = renderTemplate("githooks/pre-commit.ejs", rustConfig());
    expect(out).toContain("command -v node");
  });
});

// ─── githooks/pre-push.ejs ───────────────────────────────────────────────────

describe("githooks/pre-push.ejs", () => {
  it("renders without EJS tag leaks for typescript", () => {
    const out = renderTemplate("githooks/pre-push.ejs", tsConfig());
    expect(out).not.toContain("<%");
    expect(out).not.toContain("%>");
  });

  it("renders without EJS tag leaks for rust", () => {
    const out = renderTemplate("githooks/pre-push.ejs", rustConfig());
    expect(out).not.toContain("<%");
    expect(out).not.toContain("%>");
  });

  it("typescript: invokes L2 gate", () => {
    const out = renderTemplate("githooks/pre-push.ejs", tsConfig());
    expect(out).toContain("node scripts/check-all.mjs L2");
  });

  it("typescript: includes rsync workaround for # in path", () => {
    const out = renderTemplate("githooks/pre-push.ejs", tsConfig());
    expect(out).toContain("rsync -a");
    expect(out).toContain("mktemp");
  });

  it("both stacks: checks for clean working tree before push", () => {
    for (const cfg of [tsConfig(), rustConfig()]) {
      const out = renderTemplate("githooks/pre-push.ejs", cfg);
      expect(out).toContain("git status --porcelain");
    }
  });

  it("rust: invokes L2 gate", () => {
    const out = renderTemplate("githooks/pre-push.ejs", rustConfig());
    expect(out).toContain("node scripts/check-all.mjs L2");
  });

  it("rust: does NOT include rsync block", () => {
    const out = renderTemplate("githooks/pre-push.ejs", rustConfig());
    expect(out).not.toContain("rsync");
    expect(out).not.toContain("mktemp");
  });
});

// ─── githooks/commit-msg.ejs ─────────────────────────────────────────────────

describe("githooks/commit-msg.ejs", () => {
  it("renders without EJS tag leaks for typescript", () => {
    const out = renderTemplate("githooks/commit-msg.ejs", tsConfig());
    expect(out).not.toContain("<%");
    expect(out).not.toContain("%>");
  });

  it("renders without EJS tag leaks for rust", () => {
    const out = renderTemplate("githooks/commit-msg.ejs", rustConfig());
    expect(out).not.toContain("<%");
    expect(out).not.toContain("%>");
  });

  it("typescript: runs commitlint unconditionally", () => {
    const out = renderTemplate("githooks/commit-msg.ejs", tsConfig());
    expect(out).toContain("npx commitlint --edit");
  });

  it("typescript: does not guard on npx presence", () => {
    const out = renderTemplate("githooks/commit-msg.ejs", tsConfig());
    // TS path: unconditional commitlint; non-TS path has the guard
    expect(out).not.toContain("command -v npx");
  });

  it("rust: mentions commitlint", () => {
    const out = renderTemplate("githooks/commit-msg.ejs", rustConfig());
    expect(out).toContain("commitlint");
  });

  it("rust: guards on npx availability", () => {
    const out = renderTemplate("githooks/commit-msg.ejs", rustConfig());
    expect(out).toContain("command -v npx");
  });
});

// ─── githooks/setup-hooks.sh.ejs ─────────────────────────────────────────────

describe("githooks/setup-hooks.sh.ejs", () => {
  it("renders without EJS tag leaks", () => {
    const out = renderTemplate("githooks/setup-hooks.sh.ejs", rustConfig());
    expect(out).not.toContain("<%");
    expect(out).not.toContain("%>");
  });

  it("sets core.hooksPath to .githooks", () => {
    const out = renderTemplate("githooks/setup-hooks.sh.ejs", rustConfig());
    expect(out).toContain("git config core.hooksPath .githooks");
  });

  it("makes hooks executable", () => {
    const out = renderTemplate("githooks/setup-hooks.sh.ejs", rustConfig());
    expect(out).toContain("chmod +x .githooks");
  });

  it("renders identically regardless of language (no interpolation)", () => {
    const tsOut = renderTemplate("githooks/setup-hooks.sh.ejs", tsConfig());
    const rustOut = renderTemplate("githooks/setup-hooks.sh.ejs", rustConfig());
    expect(tsOut).toBe(rustOut);
  });
});
