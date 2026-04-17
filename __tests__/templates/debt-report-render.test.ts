import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/utils/render.js";
import { makeConfig } from "../helpers.js";
import { computeMetricsProfile } from "../../src/generators/debt-ratchet.js";
import type { ProjectConfig } from "../../src/wizard/types.js";

function makeDataWithProfile(overrides: Partial<ProjectConfig>) {
  const config = makeConfig("/tmp/test", overrides);
  const metricsProfile = computeMetricsProfile(config);
  return { ...config, metricsProfile } as unknown as Record<string, unknown>;
}

describe("debt-report.mjs.ejs", () => {
  for (const lang of ["typescript", "rust", "java", "go", "python"] as const) {
    it(`renders valid JS for ${lang}`, () => {
      const data = makeDataWithProfile({
        language: lang,
        enableDebtGates: true,
      });
      const rendered = renderTemplate("scripts/debt-report.mjs.ejs", data);
      expect(rendered).toContain("#!/usr/bin/env node");
      expect(rendered).toContain("debt-baseline.json");
      expect(rendered).toContain("--gate");
      expect(rendered).toContain("regressed");
    });
  }

  it("contains --require-improvement flag logic", () => {
    const data = makeDataWithProfile({ language: "typescript" });
    const rendered = renderTemplate("scripts/debt-report.mjs.ejs", data);
    expect(rendered).toContain("require-improvement");
  });

  it("outputs a markdown table", () => {
    const data = makeDataWithProfile({ language: "typescript" });
    const rendered = renderTemplate("scripts/debt-report.mjs.ejs", data);
    expect(rendered).toContain("| Metric |");
  });

  it("java debt-lib uses gradlew for gradle buildTool", () => {
    const data = makeDataWithProfile({
      language: "java",
      buildTool: "gradle",
      enableDebtGates: true,
    });
    const rendered = renderTemplate("scripts/debt-lib.mjs.ejs", data);
    expect(rendered).toContain("gradlew");
  });

  it("java debt-lib uses mvn for maven buildTool", () => {
    const data = makeDataWithProfile({
      language: "java",
      buildTool: "maven",
      enableDebtGates: true,
    });
    const rendered = renderTemplate("scripts/debt-lib.mjs.ejs", data);
    expect(rendered).toContain("mvn");
  });
});
