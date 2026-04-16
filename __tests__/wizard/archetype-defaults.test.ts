import { describe, it, expect } from "vitest";
import {
  defaultContractType,
  shouldAskContractType,
} from "../../src/wizard/archetype-defaults.js";
import type { Archetype, ContractType } from "../../src/wizard/types.js";

describe("defaultContractType", () => {
  it.each<[Archetype, boolean, ContractType]>([
    ["library", false, "none"],
    ["library", true, "none"],
    ["cli", false, "none"],
    ["cli", true, "none"],
    ["embedded", false, "none"],
    ["embedded", true, "none"],
    ["backend-web-db", true, "rest-owned"],
    ["backend-web-db", false, "none"],
    ["frontend-spa", true, "rest-public"],
    ["frontend-spa", false, "none"],
    ["data-pipeline", true, "message-queue"],
    ["data-pipeline", false, "none"],
  ])(
    "archetype=%s hasPublicApi=%s → %s",
    (archetype, hasPublicApi, expected) => {
      expect(defaultContractType(archetype, hasPublicApi)).toBe(expected);
    },
  );

  it("unknown archetype returns none regardless of hasPublicApi", () => {
    expect(defaultContractType(undefined, true)).toBe("none");
    expect(defaultContractType(undefined, false)).toBe("none");
  });
});

describe("shouldAskContractType", () => {
  it("returns false when hasPublicApi is false", () => {
    expect(shouldAskContractType({ hasPublicApi: false })).toBe(false);
  });

  it("returns false when hasPublicApi is undefined", () => {
    expect(shouldAskContractType({})).toBe(false);
  });

  it("returns true when hasPublicApi is true", () => {
    expect(shouldAskContractType({ hasPublicApi: true })).toBe(true);
  });
});
