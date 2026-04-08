import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/utils/render.js";
import { makeConfig } from "../helpers.js";

describe("capture-debt-baseline.mjs.ejs", () => {
  for (const lang of ["typescript", "rust", "java", "go", "python"] as const) {
    it(`renders valid JS for ${lang}`, () => {
      const data = makeConfig("/tmp/test", {
        language: lang,
        enableDebtGates: true,
      }) as unknown as Record<string, unknown>;
      const rendered = renderTemplate(
        "scripts/capture-debt-baseline.mjs.ejs",
        data,
      );
      expect(rendered).toContain("#!/usr/bin/env node");
      expect(rendered).toContain("debt-baseline.json");
      expect(rendered).toContain("capturedAt");
      expect(rendered).toContain("higher-is-better");
    });
  }

  it("typescript output contains vitest coverage collection", () => {
    const data = makeConfig("/tmp/test", {
      language: "typescript",
    }) as unknown as Record<string, unknown>;
    const rendered = renderTemplate(
      "scripts/capture-debt-baseline.mjs.ejs",
      data,
    );
    expect(rendered).toContain("vitest");
  });

  it("rust output contains cargo tarpaulin", () => {
    const data = makeConfig("/tmp/test", {
      language: "rust",
    }) as unknown as Record<string, unknown>;
    const rendered = renderTemplate(
      "scripts/capture-debt-baseline.mjs.ejs",
      data,
    );
    expect(rendered).toContain("tarpaulin");
  });

  it("go output contains go test -coverprofile", () => {
    const data = makeConfig("/tmp/test", {
      language: "go",
    }) as unknown as Record<string, unknown>;
    const rendered = renderTemplate(
      "scripts/capture-debt-baseline.mjs.ejs",
      data,
    );
    expect(rendered).toContain("coverprofile");
  });

  it("python output contains pytest --cov", () => {
    const data = makeConfig("/tmp/test", {
      language: "python",
    }) as unknown as Record<string, unknown>;
    const rendered = renderTemplate(
      "scripts/capture-debt-baseline.mjs.ejs",
      data,
    );
    expect(rendered).toContain("pytest");
    expect(rendered).toContain("--cov");
  });
});
