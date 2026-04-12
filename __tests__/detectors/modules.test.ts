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

  it("go: uses subdir fallback", () => {
    mkdirSync(join(dir, "backend"), { recursive: true });
    const mods = detectModules(dir, "go");
    expect(mods.map((m) => m.name)).toContain("backend");
    expect(mods[0]?.language).toBe("go");
  });

  it("rust: uses subdir fallback", () => {
    mkdirSync(join(dir, "src"), { recursive: true });
    const mods = detectModules(dir, "rust");
    expect(mods.map((m) => m.name)).toContain("src");
    expect(mods[0]?.language).toBe("rust");
  });

  it("python: uses subdir fallback", () => {
    mkdirSync(join(dir, "lib"), { recursive: true });
    const mods = detectModules(dir, "python");
    expect(mods.map((m) => m.name)).toContain("lib");
    expect(mods[0]?.language).toBe("python");
  });

  it("typescript: handles workspaces as object with packages key", () => {
    mkdirSync(join(dir, "packages", "pkg-a"), { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "root",
        workspaces: { packages: ["packages/*"] },
      }),
    );
    writeFileSync(
      join(dir, "packages/pkg-a/package.json"),
      JSON.stringify({ name: "pkg-a" }),
    );
    const mods = detectModules(dir, "typescript");
    expect(mods.map((m) => m.name)).toContain("pkg-a");
  });

  it("typescript: falls through to subdir fallback on malformed package.json", () => {
    writeFileSync(join(dir, "package.json"), "{ not valid json");
    mkdirSync(join(dir, "src"), { recursive: true });
    const mods = detectModules(dir, "typescript");
    expect(mods.map((m) => m.name)).toContain("src");
  });

  it("java: detects multi-module from Maven pom.xml", () => {
    writeFileSync(
      join(dir, "pom.xml"),
      `<project><modules><module>core</module><module>api</module></modules></project>`,
    );
    const mods = detectModules(dir, "java");
    expect(mods.map((m) => m.name).sort()).toEqual(["api", "core"]);
    expect(mods[0]?.kind).toBe("maven-module");
  });

  it("java: falls back to subdirs when no build file", () => {
    mkdirSync(join(dir, "backend"), { recursive: true });
    const mods = detectModules(dir, "java");
    expect(mods.map((m) => m.name)).toContain("backend");
  });
});
