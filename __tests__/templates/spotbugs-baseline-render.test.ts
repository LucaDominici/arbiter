import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/utils/render.js";
import { makeConfig } from "../helpers.js";

function cfg(overrides: Parameters<typeof makeConfig>[1] = {}) {
  return makeConfig("/tmp/test", overrides) as unknown as Record<
    string,
    unknown
  >;
}

describe("verify-spotbugs.mjs.ejs rendering (#212)", () => {
  const SCRIPT = "scripts/verify-spotbugs.mjs.ejs";

  it("renders without EJS leaks", () => {
    const out = renderTemplate(SCRIPT, cfg({ language: "java" }));
    expect(out).not.toContain("<%");
    expect(out).not.toContain("%>");
  });

  it("contains all security hard-block types", () => {
    const out = renderTemplate(SCRIPT, cfg({ language: "java" }));
    expect(out).toContain("SQL_INJECTION");
    expect(out).toContain("XSS_REQUEST_WRAPPER");
    expect(out).toContain("COMMAND_INJECTION");
    expect(out).toContain("XXE_DOCUMENT");
    expect(out).toContain("LDAP_INJECTION");
    expect(out).toContain("HARD_CODE_PASSWORD");
  });

  it("supports --update-baseline flag", () => {
    const out = renderTemplate(SCRIPT, cfg({ language: "java" }));
    expect(out).toContain("--update-baseline");
  });

  it("supports --report-only flag", () => {
    const out = renderTemplate(SCRIPT, cfg({ language: "java" }));
    expect(out).toContain("--report-only");
  });

  it("references spotbugs-baseline.json", () => {
    const out = renderTemplate(SCRIPT, cfg({ language: "java" }));
    expect(out).toContain("spotbugs-baseline.json");
  });

  it("exits 1 on security-category findings (hard-block must not be baselined)", () => {
    const out = renderTemplate(SCRIPT, cfg({ language: "java" }));
    expect(out).toContain("process.exit(1)");
  });
});

describe("spotbugs-baseline.json.ejs rendering (#212)", () => {
  const TEMPLATE = "scripts/spotbugs-baseline.json.ejs";

  it("renders valid JSON", () => {
    const out = renderTemplate(TEMPLATE, cfg({ language: "java" }));
    expect(() => JSON.parse(out)).not.toThrow();
  });

  it("contains baselined and policy fields", () => {
    const out = renderTemplate(TEMPLATE, cfg({ language: "java" }));
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(parsed).toHaveProperty("baselined");
    expect(Array.isArray(parsed.baselined)).toBe(true);
    expect(parsed).toHaveProperty("policy");
    expect(typeof parsed.policy).toBe("string");
  });
});
