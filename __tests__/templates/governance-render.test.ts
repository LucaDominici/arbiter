import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/utils/render.js";
import { makeConfig } from "../helpers.js";

function cfg(overrides: Parameters<typeof makeConfig>[1] = {}) {
  return makeConfig("/tmp/test", overrides) as unknown as Record<
    string,
    unknown
  >;
}

describe("governance template rendering (#166)", () => {
  describe("RACI.md.ejs", () => {
    it("renders without EJS leaks", () => {
      const out = renderTemplate("governance/RACI.md.ejs", cfg());
      expect(out).not.toContain("<%");
      expect(out).not.toContain("%>");
    });

    it("interpolates projectName in heading", () => {
      const out = renderTemplate("governance/RACI.md.ejs", cfg());
      expect(out).toContain("test-project");
    });

    it("contains RACI role columns", () => {
      const out = renderTemplate("governance/RACI.md.ejs", cfg());
      expect(out).toContain("Accountable");
      expect(out).toContain("Responsible");
      expect(out).toContain("Consulted");
      expect(out).toContain("Informed");
    });

    it("contains responsibility matrix heading", () => {
      const out = renderTemplate("governance/RACI.md.ejs", cfg());
      expect(out).toContain("Responsibility Matrix");
    });
  });
});
