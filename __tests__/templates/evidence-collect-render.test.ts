import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/utils/render.js";
import { makeConfig } from "../helpers.js";

function render(): string {
  const config = makeConfig("/tmp/test", {
    governanceLevel: "L3",
    language: "typescript",
  });
  return renderTemplate("scripts/evidence-collect.mjs.ejs", {
    ...(config as unknown as Record<string, unknown>),
    mutationThreshold: 80,
    coverageThreshold: 80,
  });
}

describe("evidence-collect.mjs.ejs render (#241)", () => {
  it("emits head_sha field in the summary object", () => {
    const out = render();
    expect(out).toContain("head_sha");
  });

  it("emits head_sha_short field in the summary object", () => {
    const out = render();
    expect(out).toContain("head_sha_short");
  });

  it("computes and embeds a canonical sha field", () => {
    const out = render();
    expect(out).toContain("computeSummarySha");
    expect(out).toContain("sha:");
  });

  it("uses git rev-parse HEAD (full SHA) for head_sha", () => {
    const out = render();
    expect(out).toMatch(/rev-parse.*HEAD/);
    expect(out).toContain("head_sha");
  });
});
