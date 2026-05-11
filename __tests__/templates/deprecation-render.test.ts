import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/utils/render.js";
import { makeConfig } from "../helpers.js";

describe("deprecation.ts.ejs (#215)", () => {
  it("renders without EJS leaks", () => {
    const data = makeConfig("/tmp/test", {
      language: "typescript",
      hasPublicApi: true,
    }) as unknown as Record<string, unknown>;
    const rendered = renderTemplate("middleware/deprecation.ts.ejs", data);
    expect(rendered).not.toContain("<%");
    expect(rendered).not.toContain("%>");
  });

  it("contains Sunset header (RFC 8594)", () => {
    const data = makeConfig("/tmp/test", {
      language: "typescript",
    }) as unknown as Record<string, unknown>;
    const rendered = renderTemplate("middleware/deprecation.ts.ejs", data);
    expect(rendered).toContain("Sunset");
  });

  it("contains Deprecation header", () => {
    const data = makeConfig("/tmp/test", {
      language: "typescript",
    }) as unknown as Record<string, unknown>;
    const rendered = renderTemplate("middleware/deprecation.ts.ejs", data);
    expect(rendered).toContain("Deprecation");
  });

  it("contains Link header with rel=successor-version", () => {
    const data = makeConfig("/tmp/test", {
      language: "typescript",
    }) as unknown as Record<string, unknown>;
    const rendered = renderTemplate("middleware/deprecation.ts.ejs", data);
    expect(rendered).toContain("Link");
    expect(rendered).toContain("successor-version");
  });

  it("exports deprecationMiddleware function", () => {
    const data = makeConfig("/tmp/test", {
      language: "typescript",
    }) as unknown as Record<string, unknown>;
    const rendered = renderTemplate("middleware/deprecation.ts.ejs", data);
    expect(rendered).toContain("deprecationMiddleware");
    expect(rendered).toMatch(/export/);
  });
});

describe("410-gone-handler.ts.ejs (#215)", () => {
  it("renders without EJS leaks", () => {
    const data = makeConfig("/tmp/test", {
      language: "typescript",
    }) as unknown as Record<string, unknown>;
    const rendered = renderTemplate("middleware/410-gone-handler.ts.ejs", data);
    expect(rendered).not.toContain("<%");
    expect(rendered).not.toContain("%>");
  });

  it("returns 410 status code", () => {
    const data = makeConfig("/tmp/test", {
      language: "typescript",
    }) as unknown as Record<string, unknown>;
    const rendered = renderTemplate("middleware/410-gone-handler.ts.ejs", data);
    expect(rendered).toContain("410");
    expect(rendered).toContain("Gone");
  });

  it("exports goneHandler function", () => {
    const data = makeConfig("/tmp/test", {
      language: "typescript",
    }) as unknown as Record<string, unknown>;
    const rendered = renderTemplate("middleware/410-gone-handler.ts.ejs", data);
    expect(rendered).toMatch(/export.*gone|goneHandler/i);
  });
});

describe("DeprecationInterceptor.java.ejs (#215)", () => {
  it("renders without EJS leaks", () => {
    const data = makeConfig("/tmp/test", {
      language: "java",
      basePackage: "com.example",
    }) as unknown as Record<string, unknown>;
    const rendered = renderTemplate(
      "java/DeprecationInterceptor.java.ejs",
      data,
    );
    expect(rendered).not.toContain("<%");
    expect(rendered).not.toContain("%>");
  });

  it("contains Sunset header", () => {
    const data = makeConfig("/tmp/test", {
      language: "java",
    }) as unknown as Record<string, unknown>;
    const rendered = renderTemplate(
      "java/DeprecationInterceptor.java.ejs",
      data,
    );
    expect(rendered).toContain("Sunset");
  });

  it("implements HandlerInterceptor", () => {
    const data = makeConfig("/tmp/test", {
      language: "java",
    }) as unknown as Record<string, unknown>;
    const rendered = renderTemplate(
      "java/DeprecationInterceptor.java.ejs",
      data,
    );
    expect(rendered).toContain("HandlerInterceptor");
    expect(rendered).toContain("postHandle");
  });
});
