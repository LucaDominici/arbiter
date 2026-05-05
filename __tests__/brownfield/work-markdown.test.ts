import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import {
  createTestProject,
  initGit,
  cleanupTestProject,
  makeConfig,
} from "../helpers.js";
import { runGenerators, runInit } from "../../src/commands/init.js";

vi.mock("../../src/compatibility/probe.js", () => ({
  runProbes: vi.fn(),
}));

describe("brownfield: markdown backend re-init preserves .arbiter/work/ (CANON-11)", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestProject("typescript");
    initGit(dir);
  });

  afterEach(() => {
    cleanupTestProject(dir);
  });

  function markdownConfig() {
    return makeConfig(dir, {
      language: "typescript",
      tools: ["claude"],
      useGitHub: false,
      decompositionBackend: "markdown",
    });
  }

  it("re-init does not delete existing .arbiter/work/ files", () => {
    const workDir = join(dir, ".arbiter", "work");
    mkdirSync(workDir, { recursive: true });
    const seedFile = join(workDir, "WU-001.md");
    writeFileSync(
      seedFile,
      "---\nid: WU-001\ntitle: existing unit\nstatus: open\n---\nbody\n",
    );

    const config = markdownConfig();
    runGenerators(config);

    expect(existsSync(seedFile)).toBe(true);
    expect(readFileSync(seedFile, "utf-8")).toContain("existing unit");
  });

  it("re-init does not overwrite .arbiter/work/ with empty directory", () => {
    const workDir = join(dir, ".arbiter", "work");
    mkdirSync(workDir, { recursive: true });
    writeFileSync(join(workDir, "WU-001.md"), "seed");
    writeFileSync(join(workDir, "WU-002.md"), "seed2");

    runGenerators(markdownConfig());

    const files = readdirSync(workDir);
    expect(files).toContain("WU-001.md");
    expect(files).toContain("WU-002.md");
  });

  it("first-run scaffolds .arbiter/work/ when absent", async () => {
    expect(existsSync(join(dir, ".arbiter"))).toBe(false);

    await runInit({
      yes: true,
      tools: "claude",
      level: "L2",
      dir,
      noVerify: true,
      dryRun: false,
      obsidian: false,
      brownfield: false,
      backend: "markdown",
    });

    expect(existsSync(join(dir, ".arbiter", "work"))).toBe(true);
  });
});
