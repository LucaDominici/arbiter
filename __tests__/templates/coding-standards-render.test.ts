import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/utils/render.js";
import { makeConfig } from "../helpers.js";

function cfg(overrides: Parameters<typeof makeConfig>[1] = {}) {
  return makeConfig("/tmp/test", overrides) as unknown as Record<
    string,
    unknown
  >;
}

const TEMPLATE = "docs/CODING_STANDARDS.md.ejs";

describe("CODING_STANDARDS.md.ejs rendering (#206)", () => {
  describe("TypeScript L2", () => {
    let out: string;
    it("renders without EJS leaks", () => {
      out = renderTemplate(
        TEMPLATE,
        cfg({ governanceLevel: "L2", language: "typescript" }),
      );
      expect(out).not.toContain("<%");
      expect(out).not.toContain("%>");
    });

    it("contains no-any rule", () => {
      out = renderTemplate(
        TEMPLATE,
        cfg({ governanceLevel: "L2", language: "typescript" }),
      );
      expect(out).toContain("No `any` type");
    });

    it("contains knip reference", () => {
      out = renderTemplate(
        TEMPLATE,
        cfg({ governanceLevel: "L2", language: "typescript" }),
      );
      expect(out.toLowerCase()).toContain("knip");
    });

    it("contains 80% coverage threshold", () => {
      out = renderTemplate(
        TEMPLATE,
        cfg({ governanceLevel: "L2", language: "typescript" }),
      );
      expect(out).toContain("80");
    });

    it("does NOT contain JVM/Java/SpotBugs section", () => {
      out = renderTemplate(
        TEMPLATE,
        cfg({ governanceLevel: "L2", language: "typescript" }),
      );
      expect(out).not.toContain("SpotBugs");
      expect(out).not.toContain("JaCoCo");
    });
  });

  describe("Java L2", () => {
    let out: string;
    it("renders without EJS leaks", () => {
      out = renderTemplate(
        TEMPLATE,
        cfg({ governanceLevel: "L2", language: "java" }),
      );
      expect(out).not.toContain("<%");
      expect(out).not.toContain("%>");
    });

    it("contains SpotBugs reference", () => {
      out = renderTemplate(
        TEMPLATE,
        cfg({ governanceLevel: "L2", language: "java" }),
      );
      expect(out).toContain("SpotBugs");
    });

    it("contains JaCoCo reference", () => {
      out = renderTemplate(
        TEMPLATE,
        cfg({ governanceLevel: "L2", language: "java" }),
      );
      expect(out).toContain("JaCoCo");
    });

    it("contains Checkstyle reference", () => {
      out = renderTemplate(
        TEMPLATE,
        cfg({ governanceLevel: "L2", language: "java" }),
      );
      expect(out).toContain("Checkstyle");
    });

    it("does NOT contain TypeScript section", () => {
      out = renderTemplate(
        TEMPLATE,
        cfg({ governanceLevel: "L2", language: "java" }),
      );
      expect(out).not.toContain("Knip");
    });
  });

  describe("Kotlin L2", () => {
    it("renders without EJS leaks", () => {
      const out = renderTemplate(
        TEMPLATE,
        cfg({ governanceLevel: "L2", language: "kotlin" }),
      );
      expect(out).not.toContain("<%");
      expect(out).not.toContain("%>");
    });

    it("contains SpotBugs reference (shares JVM section)", () => {
      const out = renderTemplate(
        TEMPLATE,
        cfg({ governanceLevel: "L2", language: "kotlin" }),
      );
      expect(out).toContain("SpotBugs");
    });
  });

  describe("Python L2", () => {
    it("renders without EJS leaks", () => {
      const out = renderTemplate(
        TEMPLATE,
        cfg({ governanceLevel: "L2", language: "python" }),
      );
      expect(out).not.toContain("<%");
      expect(out).not.toContain("%>");
    });

    it("contains type hints / PEP 484 reference", () => {
      const out = renderTemplate(
        TEMPLATE,
        cfg({ governanceLevel: "L2", language: "python" }),
      );
      expect(out.toLowerCase()).toMatch(/type hints|pep 484/i);
    });
  });

  describe("Go L2", () => {
    it("renders without EJS leaks", () => {
      const out = renderTemplate(
        TEMPLATE,
        cfg({ governanceLevel: "L2", language: "go" }),
      );
      expect(out).not.toContain("<%");
      expect(out).not.toContain("%>");
    });

    it("contains gofmt or go vet reference", () => {
      const out = renderTemplate(
        TEMPLATE,
        cfg({ governanceLevel: "L2", language: "go" }),
      );
      expect(out.toLowerCase()).toMatch(/gofmt|go vet/i);
    });
  });

  describe("Rust L2", () => {
    it("renders without EJS leaks", () => {
      const out = renderTemplate(
        TEMPLATE,
        cfg({ governanceLevel: "L2", language: "rust" }),
      );
      expect(out).not.toContain("<%");
      expect(out).not.toContain("%>");
    });

    it("contains clippy reference", () => {
      const out = renderTemplate(
        TEMPLATE,
        cfg({ governanceLevel: "L2", language: "rust" }),
      );
      expect(out.toLowerCase()).toContain("clippy");
    });
  });

  describe("unknown language L2", () => {
    it("renders without EJS leaks", () => {
      const out = renderTemplate(
        TEMPLATE,
        cfg({ governanceLevel: "L2", language: "unknown" }),
      );
      expect(out).not.toContain("<%");
      expect(out).not.toContain("%>");
    });

    it("contains only the General section", () => {
      const out = renderTemplate(
        TEMPLATE,
        cfg({ governanceLevel: "L2", language: "unknown" }),
      );
      expect(out).toContain("## General");
      expect(out).not.toContain("SpotBugs");
      expect(out).not.toContain("Knip");
      expect(out).not.toContain("clippy");
      expect(out).not.toContain("gofmt");
    });
  });

  describe("L3 governance additions", () => {
    it("renders without EJS leaks at L3", () => {
      const out = renderTemplate(
        TEMPLATE,
        cfg({ governanceLevel: "L3", language: "typescript" }),
      );
      expect(out).not.toContain("<%");
      expect(out).not.toContain("%>");
    });

    it("contains L3 governance section", () => {
      const out = renderTemplate(
        TEMPLATE,
        cfg({ governanceLevel: "L3", language: "typescript" }),
      );
      expect(out).toMatch(/openapi|adr|l3 governance/i);
    });

    it("does NOT contain L3 section at L2", () => {
      const out = renderTemplate(
        TEMPLATE,
        cfg({ governanceLevel: "L2", language: "typescript" }),
      );
      expect(out).not.toMatch(/openapi|L3 Governance/i);
    });
  });
});
