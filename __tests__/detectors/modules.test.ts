import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectModules } from "../../src/detectors/modules.js";

describe("detectModules", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-modules-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("typescript: detects workspaces from package.json", () => {
    mkdirSync(join(dir, "packages", "core"), { recursive: true });
    mkdirSync(join(dir, "packages", "ui"), { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "root",
        workspaces: ["packages/*"],
      }),
    );
    writeFileSync(
      join(dir, "packages/core/package.json"),
      JSON.stringify({ name: "@proj/core" }),
    );
    writeFileSync(
      join(dir, "packages/ui/package.json"),
      JSON.stringify({ name: "@proj/ui" }),
    );

    const mods = detectModules(dir, "typescript");
    expect(mods.map((m) => m.name).sort()).toEqual(["@proj/core", "@proj/ui"]);
  });

  it("typescript: falls back to top-level source dirs when no workspaces", () => {
    mkdirSync(join(dir, "src"), { recursive: true });
    mkdirSync(join(dir, "backend"), { recursive: true });
    mkdirSync(join(dir, "frontend"), { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "root" }));

    const mods = detectModules(dir, "typescript");
    const names = mods.map((m) => m.name).sort();
    expect(names).toContain("backend");
    expect(names).toContain("frontend");
    expect(names).toContain("src");
  });

  it("java: detects multi-module from settings.gradle includes", () => {
    writeFileSync(
      join(dir, "settings.gradle"),
      "rootProject.name = 'proj'\ninclude 'backend'\ninclude 'api'\n",
    );
    const mods = detectModules(dir, "java");
    expect(mods.map((m) => m.name).sort()).toEqual(["api", "backend"]);
  });

  it("unknown language: returns empty", () => {
    const mods = detectModules(dir, "unknown");
    expect(mods).toEqual([]);
  });

  it("non-existent directory: returns empty", () => {
    const mods = detectModules(join(dir, "nope"), "typescript");
    expect(mods).toEqual([]);
  });
});
