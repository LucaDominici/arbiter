import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/utils/render.js";
import { makeConfig } from "../helpers.js";

const POLICY_LIST =
  "SQL_INJECTION, XSS, COMMAND_INJECTION, LDAP_INJECTION, HARD_CODE_PASSWORD";

function cfg(overrides: Parameters<typeof makeConfig>[1] = {}) {
  return makeConfig("/tmp/test", {
    language: "java",
    ...overrides,
  }) as unknown as Record<string, unknown>;
}

describe("owasp-suppressions.xml.ejs rendering (CANON-04, #208)", () => {
  it("renders without EJS leaks", () => {
    const out = renderTemplate(
      "suppressions/owasp-suppressions.xml.ejs",
      cfg(),
    );
    expect(out).not.toContain("<%");
    expect(out).not.toContain("%>");
  });

  it("contains XML declaration header", () => {
    const out = renderTemplate(
      "suppressions/owasp-suppressions.xml.ejs",
      cfg(),
    );
    expect(out).toContain('<?xml version="1.0"');
  });

  it("contains policy comment with exact no-suppress category list (CANON-15)", () => {
    const out = renderTemplate(
      "suppressions/owasp-suppressions.xml.ejs",
      cfg(),
    );
    expect(out).toContain(POLICY_LIST);
  });

  it("contains <suppressions element", () => {
    const out = renderTemplate(
      "suppressions/owasp-suppressions.xml.ejs",
      cfg(),
    );
    expect(out).toContain("<suppressions");
  });

  it("contains xmlns attribute for schema", () => {
    const out = renderTemplate(
      "suppressions/owasp-suppressions.xml.ejs",
      cfg(),
    );
    expect(out).toContain("xmlns=");
  });
});
