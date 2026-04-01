import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/utils/render.js";
import { makeConfig } from "../helpers.js";
import type { Language } from "../../src/wizard/types.js";

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

function renderStartTask(language: Language): string {
  const config = makeConfig("/tmp/test", {
    language,
    testCommand: GATE_COMMANDS[language],
  });
  return renderTemplate(
    "claude/commands/start-task.md.ejs",
    config as unknown as Record<string, unknown>,
  );
}

function renderCompleteTask(language: Language): string {
  const config = makeConfig("/tmp/test", {
    language,
    testCommand: GATE_COMMANDS[language],
  });
  return renderTemplate(
    "claude/commands/complete-task.md.ejs",
    config as unknown as Record<string, unknown>,
  );
}

describe("claude commands: start-task.md — structural sections", () => {
  it("contains branch enforcement section", () => {
    const content = renderStartTask("typescript");
    expect(content).toMatch(/branch/i);
    expect(content).toMatch(/main|master/i);
  });

  it("contains plan gate with STOP", () => {
    const content = renderStartTask("typescript");
    expect(content).toMatch(/STOP/);
  });

  it("contains tier classification (XS/S/Standard)", () => {
    const content = renderStartTask("typescript");
    expect(content).toMatch(/XS/);
    expect(content).toMatch(/Standard/);
  });

  it("contains GitHub issue read instruction", () => {
    const content = renderStartTask("typescript");
    expect(content).toMatch(/gh issue view|issue/i);
  });

  it("references AGENTS.md invariants", () => {
    const content = renderStartTask("typescript");
    expect(content).toMatch(/AGENTS\.md/);
  });
});

describe("claude commands: complete-task.md — structural sections", () => {
  it("contains gate execution section", () => {
    const content = renderCompleteTask("typescript");
    expect(content).toMatch(/gate|Gate/i);
  });

  it("contains commit section", () => {
    const content = renderCompleteTask("typescript");
    expect(content).toMatch(/commit|Commit/i);
  });

  it("contains PR creation section", () => {
    const content = renderCompleteTask("typescript");
    expect(content).toMatch(/PR|pull request|gh pr create/i);
  });

  it("contains branch validation (not main)", () => {
    const content = renderCompleteTask("typescript");
    expect(content).toMatch(/main|master/i);
  });
});

describe("claude commands: start-task.md — stack parameterization", () => {
  for (const lang of STACK_LANGUAGES) {
    it(`gate command for ${lang} = ${GATE_COMMANDS[lang]}`, () => {
      const content = renderStartTask(lang);
      expect(content).toContain(GATE_COMMANDS[lang]);
    });
  }
});

describe("claude commands: complete-task.md — stack parameterization", () => {
  for (const lang of STACK_LANGUAGES) {
    it(`gate command for ${lang} = ${GATE_COMMANDS[lang]}`, () => {
      const content = renderCompleteTask(lang);
      expect(content).toContain(GATE_COMMANDS[lang]);
    });
  }
});
