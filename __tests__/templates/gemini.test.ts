import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/utils/render.js";
import { makeConfig } from "../helpers.js";
import type { Language } from "../../src/wizard/types.js";

const GATE_MAP: Record<string, string> = {
  typescript: "npm run test",
  java: "./gradlew test",
  rust: "cargo test",
  go: "go test ./...",
  python: "pytest",
};

function renderGeminiMd(language: Language, testCommand?: string): string {
  const config = makeConfig("/tmp/test", {
    language,
    testCommand: testCommand ?? GATE_MAP[language] ?? "echo test",
  });
  return renderTemplate(
    "gemini/GEMINI.md.ejs",
    config as unknown as Record<string, unknown>,
  );
}

const STACK_LANGUAGES: Language[] = [
  "typescript",
  "java",
  "rust",
  "go",
  "python",
];

describe("gemini GEMINI.md template", () => {
  it("renders without error for typescript", () => {
    const content = renderGeminiMd("typescript");
    expect(content.length).toBeGreaterThan(0);
  });

  it("references AGENTS.md as canonical source", () => {
    const content = renderGeminiMd("typescript");
    expect(content).toContain("AGENTS.md");
    expect(content).toContain("canonical");
  });

  it("includes task workflow section", () => {
    const content = renderGeminiMd("typescript");
    expect(content).toMatch(/task.*workflow|workflow.*task/i);
  });

  it("references gate commands", () => {
    const content = renderGeminiMd("typescript");
    expect(content).toContain("check-all.mjs");
  });

  for (const lang of STACK_LANGUAGES) {
    it(`workflow references correct test command for ${lang}`, () => {
      const content = renderGeminiMd(lang);
      expect(content).toContain(GATE_MAP[lang]);
    });
  }
});
