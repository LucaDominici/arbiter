import { describe, it, expect } from "vitest";
import { matches } from "../../src/compatibility/matcher.js";

describe("matches", () => {
  it("accepts version within >=X range", () => {
    expect(matches({ major: 20, minor: 11, patch: 1 }, ">=18")).toBe(true);
  });

  it("rejects version below >=X range", () => {
    expect(matches({ major: 16, minor: 0, patch: 0 }, ">=18")).toBe(false);
  });

  it("accepts version within >=X <Y range", () => {
    expect(matches({ major: 20, minor: 11, patch: 1 }, ">=18 <22")).toBe(true);
  });

  it("rejects version above <Y bound", () => {
    expect(matches({ major: 22, minor: 0, patch: 0 }, ">=18 <22")).toBe(false);
  });

  it("accepts exact lower bound with >=X <Y", () => {
    expect(matches({ major: 18, minor: 0, patch: 0 }, ">=18 <22")).toBe(true);
  });

  it("rejects exact upper bound with <Y (exclusive)", () => {
    expect(matches({ major: 22, minor: 0, patch: 0 }, ">=18 <22")).toBe(false);
  });

  it("accepts with >X range", () => {
    expect(matches({ major: 19, minor: 0, patch: 0 }, ">18")).toBe(true);
  });

  it("rejects equal value for >X (strict)", () => {
    expect(matches({ major: 18, minor: 0, patch: 0 }, ">18")).toBe(false);
  });

  it("accepts with <=X range", () => {
    expect(matches({ major: 3, minor: 9, patch: 6 }, ">=3 <=3.9")).toBe(true);
  });

  it("handles single version constraint", () => {
    expect(matches({ major: 1, minor: 22, patch: 0 }, ">=1.21")).toBe(true);
  });

  it("rejects below minor-aware bound", () => {
    expect(matches({ major: 1, minor: 20, patch: 0 }, ">=1.21")).toBe(false);
  });
});
