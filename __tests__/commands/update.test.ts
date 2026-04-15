import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTestProject, cleanupTestProject } from "../helpers.js";
import { runUpdate } from "../../src/commands/update.js";
import { loadConfig } from "../../src/utils/config.js";

describe("runUpdate axis-field persistence (M2 regression)", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestProject("typescript");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanupTestProject(dir);
  });

  it("persists explicit axis fields back to arbiter.json", () => {
    writeFileSync(
      join(dir, "arbiter.json"),
      JSON.stringify({
        version: "0.1",
        tools: ["claude"],
        governanceLevel: "L2",
        useGitHub: false,
        archetype: "frontend-spa",
        architectureStyle: "none",
        isMultiTenant: false,
        hasDatabase: false,
        hasPublicApi: false,
      }),
    );

    runUpdate({ dir, github: false });

    const saved = loadConfig(dir);
    expect(saved?.archetype).toBe("frontend-spa");
    expect(saved?.architectureStyle).toBe("none");
    expect(saved?.isMultiTenant).toBe(false);
    expect(saved?.hasDatabase).toBe(false);
    expect(saved?.hasPublicApi).toBe(false);
  });

  it("detects and persists axis fields when absent from stored config", () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { express: "^4.0.0" } }),
    );
    writeFileSync(
      join(dir, "arbiter.json"),
      JSON.stringify({
        version: "0.1",
        tools: ["claude"],
        governanceLevel: "L2",
        useGitHub: false,
      }),
    );

    runUpdate({ dir, github: false });

    const saved = loadConfig(dir);
    expect(saved?.archetype).toBe("backend-web-db");
    expect(saved?.architectureStyle).toBe("none");
    expect(saved?.hasDatabase).toBe(true);
    expect(saved?.hasPublicApi).toBe(true);
  });
});
