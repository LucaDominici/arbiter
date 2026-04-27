import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/utils/render.js";
import { makeConfig } from "../helpers.js";
import type { Language, GovernanceLevel } from "../../src/wizard/types.js";

/**
 * M11: Workflow commands — Claude command templates must be parameterized
 * by stack (5 languages), governance level (3 levels), and contain
 * the required structural sections.
 *
 * INV-11: Full matrix coverage.
 */

// Stack-specific gate commands expected in generated commands
const GATE_COMMANDS: Record<Language, string> = {
  typescript: "npm run test",
  java: "./gradlew test",
  rust: "cargo test",
  go: "go test ./...",
  python: "pytest",
  unknown: "echo",
};

const STACK_LANGUAGES: Language[] = [
  "typescript",
  "java",
  "rust",
  "go",
  "python",
];

function renderTask(
  language: Language = "typescript",
  governanceLevel: GovernanceLevel = "L2",
): string {
  const config = makeConfig("/tmp/test", {
    language,
    governanceLevel,
    testCommand: GATE_COMMANDS[language],
  });
  return renderTemplate(
    "claude/commands/task.md.ejs",
    config as unknown as Record<string, unknown>,
  );
}

describe("claude commands: task.md — structural sections", () => {
  it("contains branch enforcement section", () => {
    const content = renderTask();
    expect(content).toMatch(/branch/i);
    expect(content).toMatch(/main|master/i);
  });

  it("contains plan gate with STOP", () => {
    const content = renderTask();
    expect(content).toMatch(/STOP/);
  });

  it("has PLAN/EXEC split", () => {
    const content = renderTask();
    expect(content).toMatch(/PHASE PLAN/);
    expect(content).toMatch(/PHASE EXEC/);
  });

  it("contains preflight section with flag parsing", () => {
    const content = renderTask();
    expect(content).toMatch(/Preflight/i);
    expect(content).toMatch(/skip-review/);
    expect(content).toMatch(/dry-run/);
  });

  it("contains tier classification (XS/S/Standard) at L2+", () => {
    const content = renderTask();
    expect(content).toMatch(/XS/);
    expect(content).toMatch(/Standard/);
  });

  it("contains state file writes (.task-id, .task-phase, .task-plan)", () => {
    const content = renderTask();
    expect(content).toMatch(/\.task-id/);
    expect(content).toMatch(/\.task-phase/);
    expect(content).toMatch(/\.task-plan/);
  });

  it("contains code review agent dispatch section at L2+", () => {
    const content = renderTask();
    expect(content).toMatch(/Silent failure hunter/);
    expect(content).toMatch(/agents-dispatched/);
    expect(content).toMatch(/Adversarial Verifier/);
  });

  it("contains worktree recommendation at L2+", () => {
    const content = renderTask();
    expect(content).toMatch(/wt-open/);
  });

  it("contains cleanup phase at L2+", () => {
    const content = renderTask();
    expect(content).toMatch(/Cleanup/i);
    expect(content).toMatch(/wt-close/);
  });

  it("contains GitHub issue read instruction", () => {
    const content = renderTask();
    expect(content).toMatch(/gh issue view|issue/i);
  });

  it("references AGENTS.md invariants", () => {
    const content = renderTask();
    expect(content).toMatch(/AGENTS\.md/);
  });

  it("contains gate execution section", () => {
    const content = renderTask();
    expect(content).toMatch(/gate|Gate/i);
  });

  it("contains commit section", () => {
    const content = renderTask();
    expect(content).toMatch(/commit|Commit/i);
  });

  it("contains PR creation section", () => {
    const content = renderTask();
    expect(content).toMatch(/PR|pull request|gh pr create/i);
  });

  it("contains branch validation (not main)", () => {
    const content = renderTask();
    expect(content).toMatch(/main|master/i);
  });
});

describe("claude commands: task.md — governance level gating", () => {
  it("L1 does NOT include code review agent section", () => {
    const content = renderTask("typescript", "L1");
    expect(content).not.toMatch(/Adversarial Verifier/);
    expect(content).not.toMatch(/agents-dispatched/);
  });

  it("L1 does NOT include cleanup phase", () => {
    const content = renderTask("typescript", "L1");
    expect(content).not.toMatch(/\bCleanup\b/);
  });

  it("L1 does NOT include worktree recommendation", () => {
    const content = renderTask("typescript", "L1");
    expect(content).not.toMatch(/wt-open/);
  });

  it("L2 includes code review agents and verifier", () => {
    const content = renderTask("typescript", "L2");
    expect(content).toMatch(/Adversarial Verifier/);
    expect(content).toMatch(/agents-dispatched/);
  });

  it("L3 includes verification criteria section", () => {
    const content = renderTask("typescript", "L3");
    expect(content).toMatch(/Verification criteria/);
    expect(content).toMatch(/SSOT updates/);
  });
});

describe("claude commands: task.md — stack parameterization", () => {
  for (const lang of STACK_LANGUAGES) {
    it(`gate command for ${lang} = ${GATE_COMMANDS[lang]}`, () => {
      const content = renderTask(lang);
      expect(content).toContain(GATE_COMMANDS[lang]);
    });
  }
});
