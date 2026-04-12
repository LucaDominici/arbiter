import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateGithubVaultNotes } from "../../src/generators/obsidian-vault-github.js";
import * as ghFetcher from "../../src/generators/obsidian-vault-github-fetch.js";
import { makeConfig } from "../helpers.js";

describe("generateGithubVaultNotes", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbiter-vault-gh-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("renders placeholder when gh is unavailable", () => {
    vi.spyOn(ghFetcher, "fetchGithubData").mockReturnValue({
      available: false,
      issues: [],
      labels: [],
    });
    const result = generateGithubVaultNotes(
      makeConfig(dir, { useGitHub: true, githubOwner: "x", githubRepo: "y" }),
    );
    expect(result.files.length).toBeGreaterThan(0);
    const content = readFileSync(
      join(dir, "docs/vault/github/open-issues.md"),
      "utf-8",
    );
    expect(content).toContain("not authenticated");
  });

  it("renders issues and per-issue notes when gh is available", () => {
    vi.spyOn(ghFetcher, "fetchGithubData").mockReturnValue({
      available: true,
      issues: [
        {
          number: 42,
          title: "Fix circular import",
          state: "open",
          labels: ["inv-01"],
          url: "https://github.com/x/y/issues/42",
          invariants: ["INV-01"],
        },
      ],
      labels: [{ name: "inv-01", invariant: "INV-01" }],
    });

    generateGithubVaultNotes(
      makeConfig(dir, { useGitHub: true, githubOwner: "x", githubRepo: "y" }),
    );

    expect(existsSync(join(dir, "docs/vault/github/open-issues.md"))).toBe(
      true,
    );
    expect(existsSync(join(dir, "docs/vault/github/issues/42.md"))).toBe(true);
    expect(existsSync(join(dir, "docs/vault/github/labels.md"))).toBe(true);

    const issueContent = readFileSync(
      join(dir, "docs/vault/github/issues/42.md"),
      "utf-8",
    );
    expect(issueContent).toContain("#42");
    expect(issueContent).toContain("INV-01");
  });

  it("skips generation entirely when useGitHub=false", () => {
    const result = generateGithubVaultNotes(
      makeConfig(dir, { useGitHub: false }),
    );
    expect(result.files).toEqual([]);
  });
});
