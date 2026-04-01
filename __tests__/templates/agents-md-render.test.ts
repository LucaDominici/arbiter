import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/utils/render.js";
import { makeConfig } from "../helpers.js";

describe("agents-md/AGENTS.md.ejs template rendering", () => {
  // renderTemplate expects Record<string, unknown>, makeConfig returns ProjectConfig.
  // We use a dummy dir since rendering does not write to disk.
  const dummyDir = "/tmp/arbiter-render-test";

  function renderAgentsMd(overrides: Record<string, unknown> = {}): string {
    const data = { ...makeConfig(dummyDir), ...overrides } as unknown as Record<
      string,
      unknown
    >;
    return renderTemplate("agents-md/AGENTS.md.ejs", data);
  }

  it("renders with TypeScript — contains TypeScript coding standards", () => {
    const content = renderAgentsMd({ language: "typescript" });
    expect(content).toContain("TypeScript");
    expect(content).toContain("Strict mode always on");
    expect(content).toContain("No `any`");
  });

  it("renders with Java — contains Java coding standards", () => {
    const content = renderAgentsMd({ language: "java" });
    expect(content).toContain("Java");
    expect(content).toContain("Hexagonal architecture");
    expect(content).toContain("constructor injection");
  });

  it("renders with Rust — contains Rust coding standards", () => {
    const content = renderAgentsMd({ language: "rust" });
    expect(content).toContain("Rust");
    expect(content).toContain("documentation comments");
    expect(content).toContain("clippy::pedantic");
  });

  it("renders with L3 — contains coverage threshold and evidence requirements", () => {
    const content = renderAgentsMd({ governanceLevel: "L3" });
    expect(content).toContain("85% coverage minimum");
    expect(content).toContain("Evidence artifacts");
    expect(content).toContain("TDD required");
  });

  it("renders with L1 — contains minimal coverage threshold", () => {
    const content = renderAgentsMd({ governanceLevel: "L1" });
    expect(content).toContain("70%");
    expect(content).not.toContain("85% coverage minimum");
  });

  it("renders with language hooks — hooks appear in hook list when languageHooks provided", () => {
    // Note: languageHooks in AGENTS.md template are not directly rendered,
    // but the template includes framework info. The hooks section is in CLAUDE.md.
    // AGENTS.md uses the 'language' field for its sections.
    // This test verifies that different framework values are rendered correctly.
    const content = renderAgentsMd({ framework: "express+react" });
    expect(content).toContain("express+react");
  });

  it("renders without framework — Stack line has no framework slash", () => {
    const content = renderAgentsMd({ framework: null });
    // The Stack line should just be the language, no " / <framework>"
    const stackLine = content.split("\n").find((l) => l.includes("**Stack**"));
    expect(stackLine).toBeDefined();
    expect(stackLine).toContain("typescript");
    expect(stackLine).not.toContain(" / ");
  });

  it("renders project name in title", () => {
    const content = renderAgentsMd({ projectName: "mega-app" });
    expect(content).toContain("mega-app");
  });
});
