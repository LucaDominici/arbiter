import { describe, it, expect } from "vitest";
import { add, multiply } from "./index.js";

describe("math", () => {
  it("adds two numbers", () => {
    expect(add(2, 3)).toBe(5);
  });

  it("multiplies two numbers", () => {
    expect(multiply(3, 4)).toBe(12);
  });
});
