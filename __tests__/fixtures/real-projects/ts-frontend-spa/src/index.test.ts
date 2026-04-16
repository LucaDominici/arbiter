import { describe, it, expect } from "vitest";
import { formatTitle, clamp } from "./index.js";

describe("ui utils", () => {
  it("trims and normalizes whitespace in title", () => {
    expect(formatTitle("  hello   world  ")).toBe("hello world");
  });

  it("clamps value within range", () => {
    expect(clamp(15, 0, 10)).toBe(10);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(5, 0, 10)).toBe(5);
  });
});
