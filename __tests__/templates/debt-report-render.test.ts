import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/utils/render.js";
import { makeConfig } from "../helpers.js";

describe("debt-report.mjs.ejs", () => {
  for (const lang of ["typescript", "rust", "java", "go", "python"] as const) {
    it(`renders valid JS for ${lang}`, () => {
      const data = makeConfig("/tmp/test", {
        language: lang,
        enableDebtGates: true,
      }) as unknown as Record<string, unknown>;
      const rendered = renderTemplate("scripts/debt-report.mjs.ejs", data);
      expect(rendered).toContain("#!/usr/bin/env node");
      expect(rendered).toContain("debt-baseline.json");
      expect(rendered).toContain("--gate");
      expect(rendered).toContain("regressed");
    });
  }

  it("contains --require-improvement flag logic", () => {
    const data = makeConfig("/tmp/test", {
      language: "typescript",
    }) as unknown as Record<string, unknown>;
    const rendered = renderTemplate("scripts/debt-report.mjs.ejs", data);
    expect(rendered).toContain("require-improvement");
  });

  it("outputs a markdown table", () => {
    const data = makeConfig("/tmp/test", {
      language: "typescript",
    }) as unknown as Record<string, unknown>;
    const rendered = renderTemplate("scripts/debt-report.mjs.ejs", data);
    expect(rendered).toContain("| Metric |");
  });

  it("renders for java with gradle buildTool", () => {
    const data = makeConfig("/tmp/test", {
      language: "java",
      buildTool: "gradle",
      enableDebtGates: true,
    }) as unknown as Record<string, unknown>;
    const rendered = renderTemplate("scripts/debt-report.mjs.ejs", data);
    expect(rendered).toContain("gradlew");
  });

  it("renders for java with maven buildTool", () => {
    const data = makeConfig("/tmp/test", {
      language: "java",
      buildTool: "maven",
      enableDebtGates: true,
    }) as unknown as Record<string, unknown>;
    const rendered = renderTemplate("scripts/debt-report.mjs.ejs", data);
    expect(rendered).toContain("mvn");
  });
});
