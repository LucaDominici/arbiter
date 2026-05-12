import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderTemplate } from "../../src/utils/render.js";
import { generateClaude } from "../../src/generators/claude.js";
import { makeConfig } from "../helpers.js";
import type { Language, GovernanceLevel } from "../../src/wizard/types.js";

/**
 * Tests for the 5 advanced hook EJS templates (M17 / issue #35).
 * Verifies: no EJS tag leaks, key markers present, stack-specific interpolation.
 */

const STACK_CONFIGS: Record<
  Language,
  Partial<Parameters<typeof makeConfig>[1]>
> = {
  typescript: {
    buildTool: "npm",
    testCommand: "npm test",
    lintCommand: "npm run lint",
    formatCommand: "npx prettier --write",
  },
  java: {
    buildTool: "gradle",
    testCommand: "./gradlew test",
    lintCommand: "./gradlew checkstyleMain",
    formatCommand: "echo ok",
  },
  rust: {
    buildTool: "cargo",
    testCommand: "cargo test",
    lintCommand: "cargo clippy",
    formatCommand: "cargo fmt",
  },
  go: {
    buildTool: "go",
    testCommand: "go test ./...",
    lintCommand: "golangci-lint run",
    formatCommand: "gofmt -w",
  },
  python: {
    buildTool: "pip",
    testCommand: "pytest",
    lintCommand: "ruff check .",
    formatCommand: "black .",
  },
  unknown: {},
};

const LANGUAGES: Language[] = ["typescript", "java", "rust", "go", "python"];

function configFor(
  lang: Language,
  level: GovernanceLevel = "L2",
): Record<string, unknown> {
  return makeConfig("/tmp/test", {
    language: lang,
    governanceLevel: level,
    ...STACK_CONFIGS[lang],
  }) as unknown as Record<string, unknown>;
}

// ─── pre-compact.mjs.ejs ──────────────────────────────────────────────────────

describe("hooks/pre-compact.mjs.ejs", () => {
  it("renders without EJS tag leaks", () => {
    const out = renderTemplate(
      "claude/hooks/pre-compact.mjs.ejs",
      configFor("typescript"),
    );
    expect(out).not.toContain("<%");
    expect(out).not.toContain("%>");
  });

  it("contains SESSION STATE banner", () => {
    const out = renderTemplate(
      "claude/hooks/pre-compact.mjs.ejs",
      configFor("typescript"),
    );
    expect(out).toContain("SESSION STATE");
  });

  it("mentions compaction", () => {
    const out = renderTemplate(
      "claude/hooks/pre-compact.mjs.ejs",
      configFor("typescript"),
    );
    expect(out).toMatch(/compact/i);
  });

  it("imports readTaskState and getRepoRoot from lib.mjs", () => {
    const out = renderTemplate(
      "claude/hooks/pre-compact.mjs.ejs",
      configFor("typescript"),
    );
    expect(out).toContain("readTaskState");
    expect(out).toContain("getRepoRoot");
    expect(out).toContain("lib.mjs");
  });

  it("renders identically for all stacks (no stack interpolation)", () => {
    const base = renderTemplate(
      "claude/hooks/pre-compact.mjs.ejs",
      configFor("typescript"),
    );
    for (const lang of ["java", "rust", "go", "python"] as Language[]) {
      const out = renderTemplate(
        "claude/hooks/pre-compact.mjs.ejs",
        configFor(lang),
      );
      expect(out).toBe(base);
    }
  });
});

// ─── pre-edit-plan-anchor.mjs.ejs ────────────────────────────────────────────

describe("hooks/pre-edit-plan-anchor.mjs.ejs", () => {
  it("renders without EJS tag leaks", () => {
    const out = renderTemplate(
      "claude/hooks/pre-edit-plan-anchor.mjs.ejs",
      configFor("typescript"),
    );
    expect(out).not.toContain("<%");
    expect(out).not.toContain("%>");
  });

  it("contains ACTIVE PLAN banner text", () => {
    const out = renderTemplate(
      "claude/hooks/pre-edit-plan-anchor.mjs.ejs",
      configFor("typescript"),
    );
    expect(out).toContain("ACTIVE PLAN");
  });

  it("only fires during implementation phase", () => {
    const out = renderTemplate(
      "claude/hooks/pre-edit-plan-anchor.mjs.ejs",
      configFor("typescript"),
    );
    expect(out).toContain("implementation");
  });

  it("reads from .task-plan state file", () => {
    const out = renderTemplate(
      "claude/hooks/pre-edit-plan-anchor.mjs.ejs",
      configFor("typescript"),
    );
    expect(out).toContain(".task-plan");
  });

  it("imports readTaskState from lib.mjs", () => {
    const out = renderTemplate(
      "claude/hooks/pre-edit-plan-anchor.mjs.ejs",
      configFor("typescript"),
    );
    expect(out).toContain("readTaskState");
    expect(out).toContain("lib.mjs");
  });

  it("renders identically for all stacks", () => {
    const base = renderTemplate(
      "claude/hooks/pre-edit-plan-anchor.mjs.ejs",
      configFor("typescript"),
    );
    for (const lang of ["java", "rust", "go", "python"] as Language[]) {
      const out = renderTemplate(
        "claude/hooks/pre-edit-plan-anchor.mjs.ejs",
        configFor(lang),
      );
      expect(out).toBe(base);
    }
  });
});

// ─── skill-forced-eval.mjs.ejs ───────────────────────────────────────────────

describe("hooks/skill-forced-eval.mjs.ejs", () => {
  it("renders without EJS tag leaks for typescript", () => {
    const out = renderTemplate(
      "claude/hooks/skill-forced-eval.mjs.ejs",
      configFor("typescript"),
    );
    expect(out).not.toContain("<%");
    expect(out).not.toContain("%>");
  });

  it("renders without EJS tag leaks for all stacks", () => {
    for (const lang of LANGUAGES) {
      const out = renderTemplate(
        "claude/hooks/skill-forced-eval.mjs.ejs",
        configFor(lang),
      );
      expect(out).not.toContain("<%");
      expect(out).not.toContain("%>");
    }
  });

  it("interpolates testCommand for typescript", () => {
    const out = renderTemplate(
      "claude/hooks/skill-forced-eval.mjs.ejs",
      configFor("typescript"),
    );
    expect(out).toContain("npm test");
  });

  it("interpolates testCommand for rust", () => {
    const out = renderTemplate(
      "claude/hooks/skill-forced-eval.mjs.ejs",
      configFor("rust"),
    );
    expect(out).toContain("cargo test");
  });

  it("interpolates testCommand for python", () => {
    const out = renderTemplate(
      "claude/hooks/skill-forced-eval.mjs.ejs",
      configFor("python"),
    );
    expect(out).toContain("pytest");
  });

  it("handles implementation phase with keyword filter", () => {
    const out = renderTemplate(
      "claude/hooks/skill-forced-eval.mjs.ejs",
      configFor("typescript"),
    );
    expect(out).toContain("implementation");
  });

  it("handles plan phase", () => {
    const out = renderTemplate(
      "claude/hooks/skill-forced-eval.mjs.ejs",
      configFor("typescript"),
    );
    expect(out).toMatch(/\bplan\b/i);
  });

  it("reads user prompt from stdin", () => {
    const out = renderTemplate(
      "claude/hooks/skill-forced-eval.mjs.ejs",
      configFor("typescript"),
    );
    expect(out).toMatch(/stdin|process\.stdin/i);
  });
});

// ─── debug-state-on-failure.mjs.ejs ──────────────────────────────────────────

describe("hooks/debug-state-on-failure.mjs.ejs", () => {
  it("renders without EJS tag leaks for typescript", () => {
    const out = renderTemplate(
      "claude/hooks/debug-state-on-failure.mjs.ejs",
      configFor("typescript"),
    );
    expect(out).not.toContain("<%");
    expect(out).not.toContain("%>");
  });

  it("renders without EJS tag leaks for all stacks", () => {
    for (const lang of LANGUAGES) {
      const out = renderTemplate(
        "claude/hooks/debug-state-on-failure.mjs.ejs",
        configFor(lang),
      );
      expect(out).not.toContain("<%");
      expect(out).not.toContain("%>");
    }
  });

  it("creates DEBUG_STATE.md", () => {
    const out = renderTemplate(
      "claude/hooks/debug-state-on-failure.mjs.ejs",
      configFor("typescript"),
    );
    expect(out).toContain("DEBUG_STATE.md");
  });

  it("tracks failure count", () => {
    const out = renderTemplate(
      "claude/hooks/debug-state-on-failure.mjs.ejs",
      configFor("typescript"),
    );
    expect(out).toMatch(/failure.*count|count.*failure/i);
  });

  it("includes typescript test command pattern", () => {
    const out = renderTemplate(
      "claude/hooks/debug-state-on-failure.mjs.ejs",
      configFor("typescript"),
    );
    expect(out).toContain("npm test");
  });

  it("includes rust test command pattern", () => {
    const out = renderTemplate(
      "claude/hooks/debug-state-on-failure.mjs.ejs",
      configFor("rust"),
    );
    expect(out).toContain("cargo test");
  });

  it("includes python test command pattern", () => {
    const out = renderTemplate(
      "claude/hooks/debug-state-on-failure.mjs.ejs",
      configFor("python"),
    );
    expect(out).toContain("pytest");
  });

  it("includes java test command pattern", () => {
    const out = renderTemplate(
      "claude/hooks/debug-state-on-failure.mjs.ejs",
      configFor("java"),
    );
    expect(out).toContain("gradlew test");
  });
});

// ─── post-edit-dispatch.mjs.ejs ───────────────────────────────────────────────

describe("hooks/post-edit-dispatch.mjs.ejs", () => {
  it("renders without EJS tag leaks for typescript", () => {
    const out = renderTemplate(
      "claude/hooks/post-edit-dispatch.mjs.ejs",
      configFor("typescript"),
    );
    expect(out).not.toContain("<%");
    expect(out).not.toContain("%>");
  });

  it("renders without EJS tag leaks for all stacks", () => {
    for (const lang of LANGUAGES) {
      const out = renderTemplate(
        "claude/hooks/post-edit-dispatch.mjs.ejs",
        configFor(lang),
      );
      expect(out).not.toContain("<%");
      expect(out).not.toContain("%>");
    }
  });

  it("typescript: contains prettier formatCommand", () => {
    const out = renderTemplate(
      "claude/hooks/post-edit-dispatch.mjs.ejs",
      configFor("typescript"),
    );
    expect(out).toContain("npx prettier --write");
  });

  it("typescript: contains eslint lintCommand", () => {
    const out = renderTemplate(
      "claude/hooks/post-edit-dispatch.mjs.ejs",
      configFor("typescript"),
    );
    expect(out).toContain("npm run lint");
  });

  it("rust: contains cargo fmt formatCommand", () => {
    const out = renderTemplate(
      "claude/hooks/post-edit-dispatch.mjs.ejs",
      configFor("rust"),
    );
    expect(out).toContain("cargo fmt");
  });

  it("rust: contains cargo clippy lintCommand", () => {
    const out = renderTemplate(
      "claude/hooks/post-edit-dispatch.mjs.ejs",
      configFor("rust"),
    );
    expect(out).toContain("cargo clippy");
  });

  it("go: contains gofmt formatCommand", () => {
    const out = renderTemplate(
      "claude/hooks/post-edit-dispatch.mjs.ejs",
      configFor("go"),
    );
    expect(out).toContain("gofmt");
  });

  it("python: contains black formatCommand", () => {
    const out = renderTemplate(
      "claude/hooks/post-edit-dispatch.mjs.ejs",
      configFor("python"),
    );
    expect(out).toContain("black");
  });

  it("python: contains ruff lintCommand", () => {
    const out = renderTemplate(
      "claude/hooks/post-edit-dispatch.mjs.ejs",
      configFor("python"),
    );
    expect(out).toContain("ruff check .");
  });

  it("skips non-source file extensions like .md and .json", () => {
    for (const lang of LANGUAGES) {
      const out = renderTemplate(
        "claude/hooks/post-edit-dispatch.mjs.ejs",
        configFor(lang),
      );
      expect(out).toMatch(/\.md|markdown/);
    }
  });

  it("reads file path from CLAUDE_TOOL_INPUT_PATH", () => {
    const out = renderTemplate(
      "claude/hooks/post-edit-dispatch.mjs.ejs",
      configFor("typescript"),
    );
    expect(out).toContain("CLAUDE_TOOL_INPUT_PATH");
  });
});

// ─── guard-task-completion.mjs.ejs ────────────────────────────────────────

describe("hooks/guard-task-completion.mjs.ejs", () => {
  it("renders without EJS tag leaks for typescript", () => {
    const out = renderTemplate(
      "claude/hooks/guard-task-completion.mjs.ejs",
      configFor("typescript"),
    );
    expect(out).not.toContain("<%");
    expect(out).not.toContain("%>");
  });

  it("renders without EJS tag leaks for all stacks", () => {
    for (const lang of LANGUAGES) {
      const out = renderTemplate(
        "claude/hooks/guard-task-completion.mjs.ejs",
        configFor(lang),
      );
      expect(out).not.toContain("<%");
      expect(out).not.toContain("%>");
    }
  });

  it("contains COMPLETION GUARD banner", () => {
    const out = renderTemplate(
      "claude/hooks/guard-task-completion.mjs.ejs",
      configFor("typescript"),
    );
    expect(out).toContain("COMPLETION GUARD");
  });

  it("reads task state via readTaskState from lib.mjs", () => {
    const out = renderTemplate(
      "claude/hooks/guard-task-completion.mjs.ejs",
      configFor("typescript"),
    );
    expect(out).toContain("readTaskState");
    expect(out).toContain("getRepoRoot");
    expect(out).toContain("lib.mjs");
  });

  it("detects completion claim patterns", () => {
    const out = renderTemplate(
      "claude/hooks/guard-task-completion.mjs.ejs",
      configFor("typescript"),
    );
    expect(out).toMatch(/task complete|task completed/i);
    expect(out).toMatch(/wrapping up|ready to/i);
  });

  it("checks .agents-dispatched counter", () => {
    const out = renderTemplate(
      "claude/hooks/guard-task-completion.mjs.ejs",
      configFor("typescript"),
    );
    expect(out).toContain("agents-dispatched");
    expect(out).toContain("minRequired");
  });

  it("only fires during implementation or verification phase", () => {
    const out = renderTemplate(
      "claude/hooks/guard-task-completion.mjs.ejs",
      configFor("typescript"),
    );
    expect(out).toContain("implementation");
    expect(out).toContain("verification");
  });

  it("reads user prompt from stdin", () => {
    const out = renderTemplate(
      "claude/hooks/guard-task-completion.mjs.ejs",
      configFor("typescript"),
    );
    expect(out).toMatch(/stdin|process\.stdin/i);
  });

  it("interpolates testCommand for typescript", () => {
    const out = renderTemplate(
      "claude/hooks/guard-task-completion.mjs.ejs",
      configFor("typescript"),
    );
    expect(out).toContain("npm test");
  });

  it("interpolates testCommand for rust", () => {
    const out = renderTemplate(
      "claude/hooks/guard-task-completion.mjs.ejs",
      configFor("rust"),
    );
    expect(out).toContain("cargo test");
  });

  it("interpolates projectName", () => {
    const out = renderTemplate(
      "claude/hooks/guard-task-completion.mjs.ejs",
      configFor("typescript"),
    );
    expect(out).toContain("test-project");
  });

  it("hard-blocks (exit 2) completion claim while phase is implementation", () => {
    const dir = mkdtempSync(join(tmpdir(), "arbiter-guard-hook-"));
    try {
      execFileSync("git", ["init", "-b", "main"], {
        cwd: dir,
        stdio: "ignore",
      });
      const hooksDir = join(dir, ".claude", "hooks");
      mkdirSync(hooksDir, { recursive: true });
      writeFileSync(
        join(hooksDir, "lib.mjs"),
        renderTemplate("claude/hooks/lib.mjs.ejs", configFor("typescript")),
      );
      const hookPath = join(hooksDir, "guard-task-completion.mjs");
      writeFileSync(
        hookPath,
        renderTemplate(
          "claude/hooks/guard-task-completion.mjs.ejs",
          configFor("typescript"),
        ),
      );
      writeFileSync(join(dir, ".claude", ".task-phase"), "implementation\n");
      writeFileSync(join(dir, ".claude", ".task-tier"), "Standard\n");
      writeFileSync(join(dir, ".agents-dispatched"), "4\n");

      const result = spawnSync("node", [hookPath], {
        cwd: dir,
        input: JSON.stringify({ prompt: "task complete, ready to merge" }),
        encoding: "utf-8",
      });

      expect(result.status).toBe(2);
      expect(result.stderr).toContain("COMPLETION GUARD");
      expect(result.stderr).toContain("phase: implementation");
      expect(result.stdout).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders process.exit(2) in guard template", () => {
    const out = renderTemplate(
      "claude/hooks/guard-task-completion.mjs.ejs",
      configFor("typescript"),
    );
    expect(out).toContain("process.exit(2)");
  });
});

// ─── check-circular-deps.mjs.ejs (#167) ────────────────────────────────────

describe("hooks/check-circular-deps.mjs.ejs (#167)", () => {
  it("renders without EJS leaks for TypeScript", () => {
    const out = renderTemplate(
      "claude/hooks/check-circular-deps.mjs.ejs",
      configFor("typescript"),
    );
    expect(out).not.toContain("<%");
    expect(out).not.toContain("%>");
  });

  it("contains madge invocation", () => {
    const out = renderTemplate(
      "claude/hooks/check-circular-deps.mjs.ejs",
      configFor("typescript"),
    );
    expect(out).toContain("madge");
  });

  it("contains circular check logic", () => {
    const out = renderTemplate(
      "claude/hooks/check-circular-deps.mjs.ejs",
      configFor("typescript"),
    );
    expect(out).toContain("circular");
  });

  it("exits 2 on circular dep found", () => {
    const out = renderTemplate(
      "claude/hooks/check-circular-deps.mjs.ejs",
      configFor("typescript"),
    );
    expect(out).toContain("process.exit(2)");
  });

  it("soft-skips when madge not installed", () => {
    const out = renderTemplate(
      "claude/hooks/check-circular-deps.mjs.ejs",
      configFor("typescript"),
    );
    expect(out.toLowerCase()).toMatch(/skip|existssync|node_modules/i);
  });

  it("uses --extensions ts,tsx,js,jsx for TypeScript file coverage", () => {
    const out = renderTemplate(
      "claude/hooks/check-circular-deps.mjs.ejs",
      configFor("typescript"),
    );
    expect(out).toContain("--extensions");
    expect(out).toContain("ts,tsx,js,jsx");
  });
});

describe("generateClaude — check-circular-deps.mjs emission (#167)", () => {
  it("emits check-circular-deps.mjs for TypeScript projects", () => {
    const dir = mkdtempSync(join(tmpdir(), "arbiter-claude-ts-"));
    try {
      const config = makeConfig(dir, { language: "typescript" });
      const result = generateClaude(config);
      const paths = result.files.map((f) => f.path);
      expect(paths.some((p) => p.endsWith("check-circular-deps.mjs"))).toBe(
        true,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  for (const lang of ["java", "rust", "go", "python"] as Language[]) {
    it(`does NOT emit check-circular-deps.mjs for ${lang} projects`, () => {
      const dir = mkdtempSync(join(tmpdir(), `arbiter-claude-${lang}-`));
      try {
        const config = makeConfig(dir, { language: lang });
        const result = generateClaude(config);
        const paths = result.files.map((f) => f.path);
        expect(paths.some((p) => p.endsWith("check-circular-deps.mjs"))).toBe(
          false,
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});

describe("hooks/post-commit-check.mjs.ejs", () => {
  it("renders without EJS tag leaks", () => {
    const out = renderTemplate(
      "claude/hooks/post-commit-check.mjs.ejs",
      configFor("typescript"),
    );
    expect(out).not.toContain("<%");
    expect(out).not.toContain("%>");
  });

  it("contains INV-22 citation", () => {
    const out = renderTemplate(
      "claude/hooks/post-commit-check.mjs.ejs",
      configFor("typescript"),
    );
    expect(out).toContain("INV-22");
  });

  it("contains exit(1) for non-conventional messages", () => {
    const out = renderTemplate(
      "claude/hooks/post-commit-check.mjs.ejs",
      configFor("typescript"),
    );
    expect(out).toContain("process.exit(1)");
  });

  it("contains conventional commit regex", () => {
    const out = renderTemplate(
      "claude/hooks/post-commit-check.mjs.ejs",
      configFor("typescript"),
    );
    expect(out).toContain("CONVENTIONAL");
    expect(out).toContain("feat|fix|refactor");
  });
});
