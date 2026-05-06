import { describe, it, expect } from "vitest";
import { validateConfig } from "../../src/config/schema.js";

function validBase() {
  return {
    version: "0.2",
    governanceLevel: "L2",
    tools: ["claude"],
    useGitHub: false,
    features: {
      contractTesting: false,
      mutationTesting: false,
      securityScanning: false,
      evidenceHarness: false,
      debtGates: true,
      suppressions: true,
    },
    thresholds: {
      lineCoverage: 80,
      branchCoverage: 70,
      mutationScore: 80,
      cyclomaticComplexity: 15,
      methodLength: 65,
      maxParams: 7,
    },
  };
}

describe("lanes schema validation", () => {
  it("accepts config without lanes field", () => {
    const result = validateConfig(validBase());
    expect(result.ok).toBe(true);
  });

  it("accepts lanes: []", () => {
    const result = validateConfig({ ...validBase(), lanes: [] });
    expect(result.ok).toBe(true);
  });

  it("accepts valid lanes array", () => {
    const result = validateConfig({
      ...validBase(),
      lanes: ["frontend", "backend", "docs"],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects lanes with invalid value", () => {
    const result = validateConfig({
      ...validBase(),
      lanes: ["frontend", "sentinel"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("sentinel"))).toBe(true);
    }
  });

  it("rejects lanes that is not an array", () => {
    const result = validateConfig({ ...validBase(), lanes: "frontend" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("lanes"))).toBe(true);
    }
  });

  it("round-trips lanes through validation", () => {
    const lanes = ["frontend", "backend"];
    const result = validateConfig({ ...validBase(), lanes });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.lanes).toEqual(lanes);
    }
  });
});
