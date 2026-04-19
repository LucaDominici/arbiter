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

function renderAiderYml(language: Language, testCommand?: string): string {
  const config = makeConfig("/tmp/test", {
    language,
    testCommand: testCommand ?? GATE_MAP[language] ?? "echo test",
  });
  return renderTemplate(
    "aider/.aider.conf.yml.ejs",
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

describe("aider .aider.conf.yml template", () => {
  it("renders without error for typescript", () => {
    const content = renderAiderYml("typescript");
    expect(content.length).toBeGreaterThan(0);
  });

  it("references AGENTS.md", () => {
    const content = renderAiderYml("typescript");
    expect(content).toContain("AGENTS.md");
  });

  it("includes auto-commits: false setting", () => {
    const content = renderAiderYml("typescript");
    expect(content).toContain("auto-commits: false");
  });

  it("references gate commands", () => {
    const content = renderAiderYml("typescript");
    expect(content).toContain("check-all.mjs");
  });

  it("is valid YAML-like format (no EJS tags remain)", () => {
    const content = renderAiderYml("typescript");
    expect(content).not.toContain("<%");
    expect(content).not.toContain("%>");
  });

  for (const lang of STACK_LANGUAGES) {
    it(`stack comment references correct test command for ${lang}`, () => {
      const content = renderAiderYml(lang);
      expect(content).toContain(GATE_MAP[lang]);
    });
  }
});
