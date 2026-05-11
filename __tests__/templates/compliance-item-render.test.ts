import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/utils/render.js";
import { makeConfig } from "../helpers.js";

describe("compliance-item.yml.ejs rendering (#199)", () => {
  it("renders Standard reference field", () => {
    const data = makeConfig("/tmp/test", {
      governanceLevel: "L2",
    }) as unknown as Record<string, unknown>;
    const content = renderTemplate(
      "github/issue-templates/compliance-item.yml.ejs",
      data,
    );
    expect(content).toContain("Standard");
  });

  it("renders Risk level field", () => {
    const data = makeConfig("/tmp/test", {
      governanceLevel: "L2",
    }) as unknown as Record<string, unknown>;
    const content = renderTemplate(
      "github/issue-templates/compliance-item.yml.ejs",
      data,
    );
    expect(content).toContain("Risk");
  });

  it("renders compliance item label", () => {
    const data = makeConfig("/tmp/test", {
      governanceLevel: "L2",
    }) as unknown as Record<string, unknown>;
    const content = renderTemplate(
      "github/issue-templates/compliance-item.yml.ejs",
      data,
    );
    expect(content).toContain("compliance");
  });
});
