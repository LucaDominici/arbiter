import { describe, it, expect } from "vitest";
import { buildRoute, parseQueryParam } from "./index.js";

describe("route helpers", () => {
  it("builds a route string", () => {
    expect(buildRoute("/health", "get")).toBe("GET /health");
  });

  it("uses fallback for missing query param", () => {
    expect(parseQueryParam(undefined, "default")).toBe("default");
  });

  it("uses provided value over fallback", () => {
    expect(parseQueryParam("foo", "default")).toBe("foo");
  });
});
