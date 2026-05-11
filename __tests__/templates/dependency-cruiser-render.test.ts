import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/utils/render.js";
import { makeConfig } from "../helpers.js";

describe(".dependency-cruiser.cjs.ejs (#216)", () => {
  it("renders without EJS syntax leaks", () => {
    const data = makeConfig("/tmp/test", {
      language: "typescript",
      governanceLevel: "L2",
    }) as unknown as Record<string, unknown>;
    const rendered = renderTemplate(
      "static-analysis/.dependency-cruiser.cjs.ejs",
      data,
    );
    expect(rendered).not.toContain("<%");
    expect(rendered).not.toContain("%>");
  });

  it("contains no-circular rule", () => {
    const data = makeConfig("/tmp/test", {
      language: "typescript",
    }) as unknown as Record<string, unknown>;
    const rendered = renderTemplate(
      "static-analysis/.dependency-cruiser.cjs.ejs",
      data,
    );
    expect(rendered).toContain("no-circular");
  });

  it("contains layer order rules (no domain→infra)", () => {
    const data = makeConfig("/tmp/test", {
      language: "typescript",
    }) as unknown as Record<string, unknown>;
    const rendered = renderTemplate(
      "static-analysis/.dependency-cruiser.cjs.ejs",
      data,
    );
    expect(rendered).toMatch(/domain|repository|service/i);
    expect(rendered).toContain("no-cross-layer");
  });

  it("contains no-orphan rule", () => {
    const data = makeConfig("/tmp/test", {
      language: "typescript",
    }) as unknown as Record<string, unknown>;
    const rendered = renderTemplate(
      "static-analysis/.dependency-cruiser.cjs.ejs",
      data,
    );
    expect(rendered).toContain("no-orphan");
  });

  it("exports a module.exports = { ... } object", () => {
    const data = makeConfig("/tmp/test", {
      language: "typescript",
    }) as unknown as Record<string, unknown>;
    const rendered = renderTemplate(
      "static-analysis/.dependency-cruiser.cjs.ejs",
      data,
    );
    expect(rendered).toContain("module.exports");
    expect(rendered).toContain("forbidden");
  });
});
