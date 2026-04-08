import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/utils/render.js";
import { makeConfig } from "../helpers.js";

/**
 * Tests for the rendered lib.mjs template.
 * Verifies that all expected exports are present after EJS rendering.
 */
describe("hooks/lib.mjs.ejs — rendered output", () => {
  const rendered = renderTemplate(
    "claude/hooks/lib.mjs.ejs",
    makeConfig("/tmp/test", { projectName: "test-proj" }) as unknown as Record<
      string,
      unknown
    >,
  );

  it("contains logInfo, logWarn, logError exports", () => {
    expect(rendered).toContain("export const logInfo");
    expect(rendered).toContain("export const logWarn");
    expect(rendered).toContain("export const logError");
  });

  it("contains readTaskState export", () => {
    expect(rendered).toContain("export function readTaskState");
  });

  it("contains getRepoRoot export", () => {
    expect(rendered).toContain("export function getRepoRoot");
  });

  it("readTaskState reads the 4 expected state files", () => {
    expect(rendered).toContain(".task-id");
    expect(rendered).toContain(".task-phase");
    expect(rendered).toContain(".task-plan");
    expect(rendered).toContain(".task-tier");
  });

  it("readTaskState returns defaults for missing files", () => {
    expect(rendered).toContain("unknown");
  });

  it("getRepoRoot uses git rev-parse as primary method", () => {
    expect(rendered).toContain("rev-parse");
  });

  it("interpolates project name correctly", () => {
    expect(rendered).toContain("test-proj");
    expect(rendered).not.toContain("<%=");
  });
});
