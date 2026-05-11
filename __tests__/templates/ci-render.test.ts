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

  // Java debt-gates job — SpotBugs step (#404)
  it("Java Gradle debt-gates job includes spotbugsMain step", () => {
    const data = makeConfig("/tmp/test", {
      language: "java",
      buildTool: "gradle",
      enableDebtGates: true,
      governanceLevel: "L2",
    }) as unknown as Record<string, unknown>;
    const rendered = renderTemplate("github/workflows/ci.yml.ejs", data);
    expect(rendered).toContain("spotbugsMain");
  });

  it("Java Maven debt-gates job includes spotbugs:check step", () => {
    const data = makeConfig("/tmp/test", {
      language: "java",
      buildTool: "maven",
      enableDebtGates: true,
      governanceLevel: "L2",
    }) as unknown as Record<string, unknown>;
    const rendered = renderTemplate("github/workflows/ci.yml.ejs", data);
    expect(rendered).toContain("spotbugs:check");
  });
});

describe("ci.yml.ejs — test-results artifact upload (#194)", () => {
  it("TypeScript: upload-artifact for test-results when enableDebtGates=true", () => {
    const data = makeConfig("/tmp/test", {
      language: "typescript",
      enableDebtGates: true,
      governanceLevel: "L2",
    }) as unknown as Record<string, unknown>;
    const rendered = renderTemplate("github/workflows/ci.yml.ejs", data);
    expect(rendered).toContain("test-results");
    expect(rendered).toContain("upload-artifact");
  });

  it("TypeScript: no test-results upload in lint-and-test when enableDebtGates=false", () => {
    const data = makeConfig("/tmp/test", {
      language: "typescript",
      enableDebtGates: false,
      governanceLevel: "L1",
    }) as unknown as Record<string, unknown>;
    const rendered = renderTemplate("github/workflows/ci.yml.ejs", data);
    expect(rendered).not.toContain("test-results");
  });

  it("Java Gradle: upload-artifact for test-results when enableDebtGates=true", () => {
    const data = makeConfig("/tmp/test", {
      language: "java",
      buildTool: "gradle",
      enableDebtGates: true,
      governanceLevel: "L2",
    }) as unknown as Record<string, unknown>;
    const rendered = renderTemplate("github/workflows/ci.yml.ejs", data);
    expect(rendered).toContain("test-results");
    expect(rendered).toContain("upload-artifact");
  });

  it("Python: upload-artifact for test-results when enableDebtGates=true", () => {
    const data = makeConfig("/tmp/test", {
      language: "python",
      enableDebtGates: true,
      governanceLevel: "L2",
    }) as unknown as Record<string, unknown>;
    const rendered = renderTemplate("github/workflows/ci.yml.ejs", data);
    expect(rendered).toContain("test-results");
    expect(rendered).toContain("upload-artifact");
  });
});
