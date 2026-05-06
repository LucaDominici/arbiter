import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/utils/render.js";
import { makeConfig } from "../helpers.js";

describe("post-edit-dispatch.mjs.ejs lane scoping", () => {
  it("single-lane: no lane-scoping block emitted", () => {
    const data = makeConfig("/tmp/test", { lanes: [] }) as unknown as Record<
      string,
      unknown
    >;
    const rendered = renderTemplate(
      "claude/hooks/post-edit-dispatch.mjs.ejs",
      data,
    );
    expect(rendered).not.toContain("_laneOf");
    expect(rendered).not.toContain("LANES");
  });

  it("multi-lane: lane-scoping shim present", () => {
    const data = makeConfig("/tmp/test", {
      lanes: ["frontend", "backend"],
    }) as unknown as Record<string, unknown>;
    const rendered = renderTemplate(
      "claude/hooks/post-edit-dispatch.mjs.ejs",
      data,
    );
    expect(rendered).toContain("LANES");
    expect(rendered).toContain("_laneOf");
    expect(rendered).toContain('"frontend"');
    expect(rendered).toContain('"backend"');
  });

  it("multi-lane: shim exits when file outside lanes", () => {
    const data = makeConfig("/tmp/test", {
      lanes: ["frontend", "backend"],
    }) as unknown as Record<string, unknown>;
    const rendered = renderTemplate(
      "claude/hooks/post-edit-dispatch.mjs.ejs",
      data,
    );
    expect(rendered).toContain("process.exit(0)");
  });

  it("single-lane: output unchanged vs default (no lanes field)", () => {
    const withEmpty = makeConfig("/tmp/test", {
      lanes: [],
    }) as unknown as Record<string, unknown>;
    const withUndefined = { ...makeConfig("/tmp/test"), lanes: undefined };
    // Both should produce identical output since lanes defaults to []
    const r1 = renderTemplate(
      "claude/hooks/post-edit-dispatch.mjs.ejs",
      withEmpty,
    );
    const r2 = renderTemplate(
      "claude/hooks/post-edit-dispatch.mjs.ejs",
      withUndefined as unknown as Record<string, unknown>,
    );
    expect(r1).toBe(r2);
  });
});
