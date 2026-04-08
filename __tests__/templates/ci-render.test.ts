import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/utils/render.js";
import { makeConfig } from "../helpers.js";

describe("ci.yml.ejs rendering", () => {
  it("includes debt-ratchet job when enableDebtGates is true", () => {
    const data = makeConfig("/tmp/test", {
      enableDebtGates: true,
    }) as unknown as Record<string, unknown>;
    const rendered = renderTemplate("github/workflows/ci.yml.ejs", data);
    expect(rendered).toContain("debt-ratchet");
    expect(rendered).toContain("debt-report.mjs");
  });

  it("does not include debt-ratchet when enableDebtGates is false", () => {
    const data = makeConfig("/tmp/test", {
      enableDebtGates: false,
      governanceLevel: "L1",
    }) as unknown as Record<string, unknown>;
    const rendered = renderTemplate("github/workflows/ci.yml.ejs", data);
    expect(rendered).not.toContain("debt-ratchet");
  });

  it("uses --gate flag at L2", () => {
    const data = makeConfig("/tmp/test", {
      enableDebtGates: true,
      governanceLevel: "L2",
    }) as unknown as Record<string, unknown>;
    const rendered = renderTemplate("github/workflows/ci.yml.ejs", data);
    expect(rendered).toContain("--gate");
  });

  it("uses --require-improvement flag at L3", () => {
    const data = makeConfig("/tmp/test", {
      enableDebtGates: true,
      governanceLevel: "L3",
    }) as unknown as Record<string, unknown>;
    const rendered = renderTemplate("github/workflows/ci.yml.ejs", data);
    expect(rendered).toContain("--require-improvement");
  });

  it("debt-ratchet is listed in ci-required needs when enableDebtGates", () => {
    const data = makeConfig("/tmp/test", {
      enableDebtGates: true,
    }) as unknown as Record<string, unknown>;
    const rendered = renderTemplate("github/workflows/ci.yml.ejs", data);
    expect(rendered).toContain("debt-ratchet");
    // Verify it appears in the ci-required section
    const ciRequired = rendered.split("ci-required:")[1];
    expect(ciRequired).toContain("debt-ratchet");
  });
});
