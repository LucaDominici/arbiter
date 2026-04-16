import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/utils/render.js";
import { getTestPyramidProfile } from "../../src/config/test-pyramid-profiles.js";
import { makeConfig } from "../helpers.js";

describe("TEST_TAXONOMY.md.ejs", () => {
  function render(overrides: Parameters<typeof makeConfig>[1] = {}): string {
    const config = makeConfig("/tmp/test", overrides);
    const profile = getTestPyramidProfile(config.archetype);
    return renderTemplate("root/TEST_TAXONOMY.md.ejs", {
      ...(config as unknown as Record<string, unknown>),
      levels: profile.levels,
      hasContainerIntegration: profile.hasContainerIntegration,
      hasPropertyTests: profile.hasPropertyTests,
      hasE2ETests: profile.hasE2ETests,
    });
  }

  // ─── cli ──────────────────────────────────────────────────────────────────

  it("cli archetype does not mention Testcontainers", () => {
    const content = render({ archetype: "cli" });
    expect(content).not.toContain("Testcontainers");
  });

  it("cli archetype does not mention database integration", () => {
    const content = render({ archetype: "cli" });
    expect(content.toLowerCase()).not.toContain("testcontainer");
  });

  it("cli archetype does not mention Playwright or E2E", () => {
    const content = render({ archetype: "cli" });
    expect(content).not.toContain("Playwright");
    expect(content).not.toContain("E2E");
  });

  it("cli archetype includes unit test section", () => {
    const content = render({ archetype: "cli" });
    expect(content).toContain("Unit");
  });

  // ─── library ──────────────────────────────────────────────────────────────

  it("library archetype includes property-based testing", () => {
    const content = render({ archetype: "library" });
    expect(content.toLowerCase()).toContain("property");
  });

  it("library archetype does not mention database", () => {
    const content = render({ archetype: "library" });
    expect(content.toLowerCase()).not.toContain("database");
    expect(content).not.toContain("Testcontainers");
  });

  it("library archetype does not mention Playwright", () => {
    const content = render({ archetype: "library" });
    expect(content).not.toContain("Playwright");
  });

  // ─── backend-web-db ───────────────────────────────────────────────────────

  it("backend-web-db includes Testcontainers", () => {
    const content = render({ archetype: "backend-web-db" });
    expect(content).toContain("Testcontainers");
  });

  it("backend-web-db includes E2E or Playwright reference", () => {
    const content = render({ archetype: "backend-web-db" });
    expect(content).toMatch(/E2E|Playwright|end-to-end/i);
  });

  it("backend-web-db includes performance testing", () => {
    const content = render({ archetype: "backend-web-db" });
    expect(content.toLowerCase()).toContain("performance");
  });

  // ─── frontend-spa ─────────────────────────────────────────────────────────

  it("frontend-spa includes Playwright or E2E", () => {
    const content = render({ archetype: "frontend-spa" });
    expect(content).toMatch(/Playwright|E2E|end-to-end/i);
  });

  it("frontend-spa does not mention Testcontainers", () => {
    const content = render({ archetype: "frontend-spa" });
    expect(content).not.toContain("Testcontainers");
  });

  // ─── data-pipeline ────────────────────────────────────────────────────────

  it("data-pipeline includes integration testing", () => {
    const content = render({ archetype: "data-pipeline" });
    expect(content.toLowerCase()).toContain("integration");
  });

  it("data-pipeline does not mention Playwright", () => {
    const content = render({ archetype: "data-pipeline" });
    expect(content).not.toContain("Playwright");
  });

  // ─── embedded ─────────────────────────────────────────────────────────────

  it("embedded does not mention Playwright or E2E", () => {
    const content = render({ archetype: "embedded" });
    expect(content).not.toContain("Playwright");
    expect(content).not.toContain("E2E");
  });

  it("embedded does not mention Testcontainers", () => {
    const content = render({ archetype: "embedded" });
    expect(content).not.toContain("Testcontainers");
  });

  // ─── general ──────────────────────────────────────────────────────────────

  it("all archetypes render without error", () => {
    for (const archetype of [
      "backend-web-db",
      "cli",
      "library",
      "data-pipeline",
      "frontend-spa",
      "embedded",
    ] as const) {
      expect(() => render({ archetype })).not.toThrow();
    }
  });

  it("contains project name", () => {
    const content = render({ archetype: "cli" });
    expect(content).toContain("test-project");
  });
});
