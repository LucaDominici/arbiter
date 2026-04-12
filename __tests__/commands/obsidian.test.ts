import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runObsidian } from "../../src/commands/obsidian.js";
import { saveConfig } from "../../src/utils/config.js";

function seedProject(dir: string): void {
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "p" }));
  saveConfig(dir, {
    version: "0.1",
    tools: ["claude"],
    governanceLevel: "L2",
    useGitHub: false,
    enableObsidianVault: true,
  });
}

describe("runObsidian", () => {
  let dir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-obs-cmd-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    logSpy.mockRestore();
  });

  it("fails without enableObsidianVault unless --force", async () => {
    saveConfig(dir, {
      version: "0.1",
      tools: ["claude"],
      governanceLevel: "L2",
      useGitHub: false,
    });
    await expect(
      runObsidian({
        sync: false,
        dryRun: false,
        force: false,
        githubOnly: false,
        dir,
      }),
    ).rejects.toThrow(/enableObsidianVault/);
  });

  it("generates vault on first run", async () => {
    seedProject(dir);
    await runObsidian({
      sync: false,
      dryRun: false,
      force: false,
      githubOnly: false,
      dir,
    });
    expect(existsSync(join(dir, "docs/vault/00-INDEX.md"))).toBe(true);
  });

  it("--sync preserves files without the generation marker", async () => {
    seedProject(dir);
    await runObsidian({
      sync: false,
      dryRun: false,
      force: false,
      githubOnly: false,
      dir,
    });

    const manualPath = join(dir, "docs/vault/prd/my-feature.md");
    mkdirSync(join(dir, "docs/vault/prd"), { recursive: true });
    writeFileSync(manualPath, "# Manual PRD\n\nHand written.\n");

    await runObsidian({
      sync: true,
      dryRun: false,
      force: false,
      githubOnly: false,
      dir,
    });
    expect(readFileSync(manualPath, "utf-8")).toContain("Hand written.");
  });

  it("--dry-run writes nothing", async () => {
    seedProject(dir);
    await runObsidian({
      sync: false,
      dryRun: true,
      force: false,
      githubOnly: false,
      dir,
    });
    expect(existsSync(join(dir, "docs/vault/00-INDEX.md"))).toBe(false);
  });

  it("two consecutive --sync runs are idempotent", async () => {
    seedProject(dir);
    await runObsidian({
      sync: false,
      dryRun: false,
      force: false,
      githubOnly: false,
      dir,
    });
    const snapshot = readFileSync(join(dir, "docs/vault/00-INDEX.md"), "utf-8");
    await runObsidian({
      sync: true,
      dryRun: false,
      force: false,
      githubOnly: false,
      dir,
    });
    await runObsidian({
      sync: true,
      dryRun: false,
      force: false,
      githubOnly: false,
      dir,
    });
    expect(readFileSync(join(dir, "docs/vault/00-INDEX.md"), "utf-8")).toBe(
      snapshot,
    );
  });
});
