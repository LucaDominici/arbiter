import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/utils/render.js";
import { makeConfig } from "../helpers.js";

function cfg(overrides: Parameters<typeof makeConfig>[1] = {}) {
  return makeConfig("/tmp/test", overrides) as unknown as Record<
    string,
    unknown
  >;
}

const TEMPLATE = "docs/MASTER_TEST_PLAN.md.ejs";

describe("MASTER_TEST_PLAN.md.ejs rendering (#209)", () => {
  describe("L2 render", () => {
    let out: string;
    it("renders without EJS leaks", () => {
      out = renderTemplate(TEMPLATE, cfg({ governanceLevel: "L2" }));
      expect(out).not.toContain("<%");
      expect(out).not.toContain("%>");
    });

    it("contains Happy path pattern", () => {
      out = renderTemplate(TEMPLATE, cfg({ governanceLevel: "L2" }));
      expect(out.toLowerCase()).toContain("happy path");
    });

    it("contains Null / empty input pattern", () => {
      out = renderTemplate(TEMPLATE, cfg({ governanceLevel: "L2" }));
      expect(out).toContain("Null / empty input");
    });

    it("contains Not found pattern", () => {
      out = renderTemplate(TEMPLATE, cfg({ governanceLevel: "L2" }));
      expect(out).toContain("Not found");
    });

    it("contains Business rule pattern", () => {
      out = renderTemplate(TEMPLATE, cfg({ governanceLevel: "L2" }));
      expect(out).toContain("Business rule");
    });

    it("contains Auth / unauthorized pattern", () => {
      out = renderTemplate(TEMPLATE, cfg({ governanceLevel: "L2" }));
      expect(out).toContain("Auth / unauthorized");
    });

    it("contains 80 coverage threshold", () => {
      out = renderTemplate(TEMPLATE, cfg({ governanceLevel: "L2" }));
      expect(out).toContain("80");
    });

    it("does NOT contain Tenant isolation at L2", () => {
      out = renderTemplate(TEMPLATE, cfg({ governanceLevel: "L2" }));
      expect(out).not.toMatch(/[Tt]enant isolation/);
    });

    it("does NOT contain Concurrency at L2", () => {
      out = renderTemplate(TEMPLATE, cfg({ governanceLevel: "L2" }));
      expect(out).not.toContain("Concurrency");
    });
  });

  describe("L3 render", () => {
    let out: string;
    it("renders without EJS leaks", () => {
      out = renderTemplate(TEMPLATE, cfg({ governanceLevel: "L3" }));
      expect(out).not.toContain("<%");
      expect(out).not.toContain("%>");
    });

    it("contains Tenant isolation at L3", () => {
      out = renderTemplate(TEMPLATE, cfg({ governanceLevel: "L3" }));
      expect(out).toContain("Tenant isolation");
    });

    it("contains Concurrency at L3", () => {
      out = renderTemplate(TEMPLATE, cfg({ governanceLevel: "L3" }));
      expect(out).toContain("Concurrency");
    });
  });
});
