import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/utils/render.js";
import { makeConfig } from "../helpers.js";
import type { Language } from "../../src/wizard/types.js";

/**
 * M11: Workflow commands — other tools (Codex, Cursor, Copilot) must include
 * workflow sections when generateWorkflow is enabled. Content must be
 * stack-parameterized.
 *
 * INV-11: Full matrix coverage across tools and stacks.
 */

const GATE_MAP: Record<string, string> = {
  typescript: "npm run test",
  java: "./gradlew test",
  rust: "cargo test",
  go: "go test ./...",
  python: "pytest",
};

function renderCodexMd(language: Language, testCommand?: string): string {
  const config = makeConfig("/tmp/test", {
    language,
    testCommand: testCommand ?? GATE_MAP[language] ?? "echo test",
  });
  return renderTemplate(
    "codex/CODEX.md.ejs",
    config as unknown as Record<string, unknown>,
  );
}

function renderCursorrules(language: Language, testCommand?: string): string {
  const config = makeConfig("/tmp/test", {
    language,
    testCommand: testCommand ?? GATE_MAP[language] ?? "echo test",
  });
  return renderTemplate(
    "cursor/.cursorrules.ejs",
    config as unknown as Record<string, unknown>,
  );
}

function renderCopilotInstructions(
  language: Language,
  testCommand?: string,
): string {
  const config = makeConfig("/tmp/test", {
    language,
    testCommand: testCommand ?? GATE_MAP[language] ?? "echo test",
  });
  return renderTemplate(
    "copilot/copilot-instructions.md.ejs",
    config as unknown as Record<string, unknown>,
  );
}

// INV-11: Full 5-stack matrix for each tool

const STACK_LANGUAGES: Language[] = [
  "typescript",
  "java",
  "rust",
  "go",
  "python",
];

describe("codex CODEX.md — workflow section", () => {
  it("includes workflow/task lifecycle section", () => {
    const content = renderCodexMd("typescript");
    expect(content).toMatch(/workflow|task lifecycle|start.task/i);
  });

  for (const lang of STACK_LANGUAGES) {
    it(`workflow references correct gate for ${lang}`, () => {
      const content = renderCodexMd(lang);
      expect(content).toContain(GATE_MAP[lang]);
    });
  }
});

describe("codex CODEX.md — Known Limitations parity section (#162)", () => {
  it("renders check-circular-deps in Known Limitations table", () => {
    const content = renderCodexMd("typescript");
    expect(content).toContain("check-circular-deps.mjs");
  });

  it("renders INV-01 in Known Limitations table", () => {
    const content = renderCodexMd("typescript");
    expect(content).toContain("INV-01");
  });

  it("renders madge workaround in Known Limitations table", () => {
    const content = renderCodexMd("typescript");
    expect(content).toContain("madge --circular src");
  });

  it("renders Known Limitations heading", () => {
    const content = renderCodexMd("typescript");
    expect(content).toContain("Known Limitations");
  });
});

describe("cursor .cursorrules — workflow section", () => {
  it("includes workflow/task lifecycle section", () => {
    const content = renderCursorrules("typescript");
    expect(content).toMatch(/workflow|task lifecycle|start.task/i);
  });

  for (const lang of STACK_LANGUAGES) {
    it(`workflow references correct gate for ${lang}`, () => {
      const content = renderCursorrules(lang);
      expect(content).toContain(GATE_MAP[lang]);
    });
  }
});

describe("copilot instructions — workflow section", () => {
  it("includes workflow/task lifecycle section", () => {
    const content = renderCopilotInstructions("typescript");
    expect(content).toMatch(/workflow|task lifecycle|start.task/i);
  });

  for (const lang of STACK_LANGUAGES) {
    it(`workflow references correct gate for ${lang}`, () => {
      const content = renderCopilotInstructions(lang);
      expect(content).toContain(GATE_MAP[lang]);
    });
  }
});
