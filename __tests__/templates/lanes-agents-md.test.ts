import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/utils/render.js";
import { makeConfig } from "../helpers.js";
import {
  getFilteredInvariants,
  getInvariantsByTier,
} from "../../src/invariants/filter.js";
import { TIER_LABELS } from "../../src/invariants/tiers.js";

function renderAgentsMd(overrides: Record<string, unknown> = {}) {
  const config = makeConfig(
    "/tmp/test",
    overrides as Parameters<typeof makeConfig>[1],
  );
  const invariants = getFilteredInvariants({
    language: config.language,
    governanceLevel: config.governanceLevel,
    invariantTiers: config.invariantTiers,
  });
  const invariantsByTier = getInvariantsByTier(invariants);
  const data: Record<string, unknown> = {
    ...(config as unknown as Record<string, unknown>),
    invariants,
    invariantsByTier,
    tierLabels: TIER_LABELS,
  };
  return renderTemplate("agents-md/AGENTS.md.ejs", data);
}

describe("AGENTS.md.ejs lane discipline section", () => {
  it("single-lane: no lane discipline section", () => {
    const content = renderAgentsMd({ lanes: [] });
    expect(content).not.toContain("Lane Discipline");
  });

  it("multi-lane: lane discipline section present", () => {
    const content = renderAgentsMd({ lanes: ["frontend", "backend"] });
    expect(content).toContain("Lane Discipline");
  });

  it("multi-lane with docs: docs lane mentioned", () => {
    const content = renderAgentsMd({ lanes: ["frontend", "backend", "docs"] });
    expect(content).toContain("docs");
  });

  it("single-lane: byte-identical output for lanes:[] vs lanes:undefined", () => {
    const withEmpty = renderAgentsMd({ lanes: [] });
    const config = makeConfig(
      "/tmp/test",
      {} as Parameters<typeof makeConfig>[1],
    );
    const invariants = getFilteredInvariants({
      language: config.language,
      governanceLevel: config.governanceLevel,
      invariantTiers: config.invariantTiers,
    });
    const invariantsByTier = getInvariantsByTier(invariants);
    const withUndefined = renderTemplate("agents-md/AGENTS.md.ejs", {
      ...(config as unknown as Record<string, unknown>),
      invariants,
      invariantsByTier,
      tierLabels: TIER_LABELS,
      lanes: undefined,
    } as unknown as Record<string, unknown>);
    expect(withEmpty).toBe(withUndefined);
  });
});
