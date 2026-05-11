import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/utils/render.js";
import { makeConfig } from "../helpers.js";

function cfg(overrides: Parameters<typeof makeConfig>[1] = {}) {
  return makeConfig("/tmp/test", overrides) as unknown as Record<
    string,
    unknown
  >;
}

describe("SECURE_CODING_CHECKLIST.md.ejs rendering (#203)", () => {
  describe("L2 render", () => {
    it("renders without EJS leaks", () => {
      const out = renderTemplate(
        "docs/SECURE_CODING_CHECKLIST.md.ejs",
        cfg({ governanceLevel: "L2" }),
      );
      expect(out).not.toContain("<%");
      expect(out).not.toContain("%>");
    });

    it("contains Input Validation section", () => {
      const out = renderTemplate(
        "docs/SECURE_CODING_CHECKLIST.md.ejs",
        cfg({ governanceLevel: "L2" }),
      );
      expect(out).toContain("Input Validation");
    });

    it("contains Authentication section", () => {
      const out = renderTemplate(
        "docs/SECURE_CODING_CHECKLIST.md.ejs",
        cfg({ governanceLevel: "L2" }),
      );
      expect(out).toContain("Authentication");
    });

    it("contains Secrets section", () => {
      const out = renderTemplate(
        "docs/SECURE_CODING_CHECKLIST.md.ejs",
        cfg({ governanceLevel: "L2" }),
      );
      expect(out).toContain("Secrets");
    });

    it("does NOT contain Tenant Isolation section at L2", () => {
      const out = renderTemplate(
        "docs/SECURE_CODING_CHECKLIST.md.ejs",
        cfg({ governanceLevel: "L2" }),
      );
      expect(out).not.toContain("Tenant Isolation");
    });

    it("does NOT contain Cryptography section at L2", () => {
      const out = renderTemplate(
        "docs/SECURE_CODING_CHECKLIST.md.ejs",
        cfg({ governanceLevel: "L2" }),
      );
      expect(out).not.toContain("Cryptography");
    });

    it("contains Logging & PII section at L2", () => {
      const out = renderTemplate(
        "docs/SECURE_CODING_CHECKLIST.md.ejs",
        cfg({ governanceLevel: "L2" }),
      );
      expect(out).toContain("Logging & PII");
    });
  });

  describe("L3 render", () => {
    it("renders without EJS leaks", () => {
      const out = renderTemplate(
        "docs/SECURE_CODING_CHECKLIST.md.ejs",
        cfg({ governanceLevel: "L3" }),
      );
      expect(out).not.toContain("<%");
      expect(out).not.toContain("%>");
    });

    it("contains Input Validation section", () => {
      const out = renderTemplate(
        "docs/SECURE_CODING_CHECKLIST.md.ejs",
        cfg({ governanceLevel: "L3" }),
      );
      expect(out).toContain("Input Validation");
    });

    it("contains Authentication section", () => {
      const out = renderTemplate(
        "docs/SECURE_CODING_CHECKLIST.md.ejs",
        cfg({ governanceLevel: "L3" }),
      );
      expect(out).toContain("Authentication");
    });

    it("contains Secrets section", () => {
      const out = renderTemplate(
        "docs/SECURE_CODING_CHECKLIST.md.ejs",
        cfg({ governanceLevel: "L3" }),
      );
      expect(out).toContain("Secrets");
    });

    it("contains Tenant Isolation section at L3", () => {
      const out = renderTemplate(
        "docs/SECURE_CODING_CHECKLIST.md.ejs",
        cfg({ governanceLevel: "L3" }),
      );
      expect(out).toContain("Tenant Isolation");
    });

    it("contains Cryptography section at L3", () => {
      const out = renderTemplate(
        "docs/SECURE_CODING_CHECKLIST.md.ejs",
        cfg({ governanceLevel: "L3" }),
      );
      expect(out).toContain("Cryptography");
    });
  });
});
