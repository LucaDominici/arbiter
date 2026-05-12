import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/utils/render.js";
import { makeConfig } from "../helpers.js";

function cfg(overrides = {}) {
  return makeConfig("/tmp/test", overrides) as unknown as Record<
    string,
    unknown
  >;
}

describe("CANONICAL_PATHS.md.ejs (#255)", () => {
  it("renders without EJS leaks", () => {
    const out = renderTemplate(
      "root/docs/METHOD/CANONICAL_PATHS.md.ejs",
      cfg(),
    );
    expect(out).not.toContain("<%");
    expect(out).not.toContain("%>");
  });

  it("contains project name", () => {
    const out = renderTemplate(
      "root/docs/METHOD/CANONICAL_PATHS.md.ejs",
      cfg({ projectName: "acme-app" }),
    );
    expect(out).toContain("acme-app");
  });

  it("contains Aliases section", () => {
    const out = renderTemplate(
      "root/docs/METHOD/CANONICAL_PATHS.md.ejs",
      cfg(),
    );
    expect(out).toContain("Aliases");
  });

  it("contains table header with Old Path and Current Path columns", () => {
    const out = renderTemplate(
      "root/docs/METHOD/CANONICAL_PATHS.md.ejs",
      cfg(),
    );
    expect(out).toContain("Old Path");
    expect(out).toContain("Current Path");
  });

  it("renders identically at L1, L2, and L3", () => {
    const l1 = renderTemplate(
      "root/docs/METHOD/CANONICAL_PATHS.md.ejs",
      cfg({ governanceLevel: "L1" }),
    );
    const l2 = renderTemplate(
      "root/docs/METHOD/CANONICAL_PATHS.md.ejs",
      cfg({ governanceLevel: "L2" }),
    );
    const l3 = renderTemplate(
      "root/docs/METHOD/CANONICAL_PATHS.md.ejs",
      cfg({ governanceLevel: "L3" }),
    );
    const normalize = (s: string) =>
      s.replace(/acme-app|test-project/g, "PROJECT");
    expect(normalize(l1)).toBe(normalize(l2));
    expect(normalize(l2)).toBe(normalize(l3));
  });
});
