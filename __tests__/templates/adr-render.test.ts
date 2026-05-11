import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/utils/render.js";
import { makeConfig } from "../helpers.js";

describe("ADR-000_template.md.ejs rendering (#192)", () => {
  it("renders projectName into the template", () => {
    const data = makeConfig("/tmp/test", {
      projectName: "myproject",
      governanceLevel: "L2",
    }) as unknown as Record<string, unknown>;
    const content = renderTemplate("docs/adr/ADR-000_template.md.ejs", data);
    expect(content).toContain("myproject");
  });

  it("renders ADR structural sections", () => {
    const data = makeConfig("/tmp/test", {
      projectName: "myproject",
      governanceLevel: "L2",
    }) as unknown as Record<string, unknown>;
    const content = renderTemplate("docs/adr/ADR-000_template.md.ejs", data);
    expect(content).toContain("Context");
    expect(content).toContain("Decision");
    expect(content).toContain("Consequences");
  });
});
