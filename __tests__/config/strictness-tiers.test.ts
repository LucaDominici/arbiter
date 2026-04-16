import { describe, it, expect } from "vitest";
import {
  getStrictnessTierRules,
  type StrictnessTierRules,
} from "../../src/config/strictness-tiers.js";

describe("getStrictnessTierRules — typescript", () => {
  it("practical tier has noUncheckedIndexedAccess disabled", () => {
    const rules = getStrictnessTierRules("typescript", "practical");
    expect(rules.noUncheckedIndexedAccess).toBe(false);
  });

  it("pedantic tier has noUncheckedIndexedAccess enabled", () => {
    const rules = getStrictnessTierRules("typescript", "pedantic");
    expect(rules.noUncheckedIndexedAccess).toBe(true);
  });

  it("pedantic tier enables strictFunctionTypes", () => {
    const rules = getStrictnessTierRules("typescript", "pedantic");
    expect(rules.strictFunctionTypes).toBe(true);
  });

  it("practical tier has no extra eslint complexity rules", () => {
    const rules = getStrictnessTierRules("typescript", "practical");
    expect(rules.eslintMaxComplexity).toBe(15);
  });

  it("pedantic tier tightens eslint max complexity", () => {
    const rules = getStrictnessTierRules("typescript", "pedantic");
    expect(rules.eslintMaxComplexity).toBeLessThan(15);
  });
});

describe("getStrictnessTierRules — rust", () => {
  it("practical tier does not enable clippy pedantic", () => {
    const rules = getStrictnessTierRules("rust", "practical");
    expect(rules.clippyPedantic).toBe(false);
  });

  it("pedantic tier enables clippy pedantic", () => {
    const rules = getStrictnessTierRules("rust", "pedantic");
    expect(rules.clippyPedantic).toBe(true);
  });
});

describe("getStrictnessTierRules — java", () => {
  it("practical tier uses standard checkstyle config", () => {
    const rules = getStrictnessTierRules("java", "practical");
    expect(rules.checkstyleExtraRules).toHaveLength(0);
  });

  it("pedantic tier adds extra checkstyle rules", () => {
    const rules = getStrictnessTierRules("java", "pedantic");
    expect(rules.checkstyleExtraRules.length).toBeGreaterThan(0);
  });
});

describe("getStrictnessTierRules — go", () => {
  it("practical tier does not enable exhaustive linters", () => {
    const rules = getStrictnessTierRules("go", "practical");
    expect(rules.golangciExtraLinters).not.toContain("exhaustruct");
  });

  it("pedantic tier enables extra linters", () => {
    const rules = getStrictnessTierRules("go", "pedantic");
    expect(rules.golangciExtraLinters.length).toBeGreaterThan(0);
  });
});

describe("getStrictnessTierRules — python", () => {
  it("practical tier uses standard ruff rules", () => {
    const rules = getStrictnessTierRules("python", "practical");
    expect(rules.ruffExtraRules).not.toContain("ANN"); // annotations enforcement
  });

  it("pedantic tier adds annotation enforcement", () => {
    const rules = getStrictnessTierRules("python", "pedantic");
    expect(rules.ruffExtraRules).toContain("ANN");
  });
});

describe("getStrictnessTierRules — unknown language", () => {
  it("returns safe defaults for unknown language", () => {
    const rules = getStrictnessTierRules("unknown", "pedantic");
    expect(rules).toBeDefined();
    expect(typeof rules).toBe("object");
  });
});

describe("StrictnessTierRules shape", () => {
  it("all languages return object with expected shape", () => {
    for (const lang of [
      "typescript",
      "java",
      "rust",
      "go",
      "python",
    ] as const) {
      const rules: StrictnessTierRules = getStrictnessTierRules(
        lang,
        "practical",
      );
      expect(typeof rules.noUncheckedIndexedAccess).toBe("boolean");
      expect(typeof rules.clippyPedantic).toBe("boolean");
      expect(Array.isArray(rules.checkstyleExtraRules)).toBe(true);
      expect(Array.isArray(rules.golangciExtraLinters)).toBe(true);
      expect(Array.isArray(rules.ruffExtraRules)).toBe(true);
    }
  });
});
