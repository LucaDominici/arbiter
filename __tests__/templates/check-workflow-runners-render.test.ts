import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/utils/render.js";
import { makeConfig } from "../helpers.js";

describe("check-workflow-runners.mjs.ejs rendering (#191)", () => {
  it("renders CI_BUILD_RUNNER_LABEL pattern guard", () => {
    const data = makeConfig("/tmp/test", {
      language: "typescript",
    }) as unknown as Record<string, unknown>;
    const content = renderTemplate(
      "scripts/check-workflow-runners.mjs.ejs",
      data,
    );
    expect(content).toContain("CI_BUILD_RUNNER_LABEL");
    expect(content).toContain("runs-on");
    expect(content).toContain("violations");
  });

  it("renders shebang and node:fs imports", () => {
    const data = makeConfig("/tmp/test", {
      language: "typescript",
    }) as unknown as Record<string, unknown>;
    const content = renderTemplate(
      "scripts/check-workflow-runners.mjs.ejs",
      data,
    );
    expect(content).toContain("#!/usr/bin/env node");
    expect(content).toContain("node:fs");
  });
});

describe("check-all.mjs.ejs wires check-workflow-runners (#191)", () => {
  it("check-all.mjs.ejs L1 block contains check-workflow-runners.mjs", () => {
    const data = makeConfig("/tmp/test", {
      language: "typescript",
      governanceLevel: "L1",
    }) as unknown as Record<string, unknown>;
    const content = renderTemplate("scripts/check-all.mjs.ejs", data);
    expect(content).toContain("check-workflow-runners.mjs");
  });
});
