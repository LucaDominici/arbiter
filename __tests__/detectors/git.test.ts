import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { detectGitInfo } from "../../src/detectors/git.js";
import { createTestProject, initGit, cleanupTestProject } from "../helpers.js";

describe("detectGitInfo", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestProject();
  });
  afterEach(() => {
    cleanupTestProject(dir);
  });

  it("returns isGitRepo=false for non-git directory", () => {
    const info = detectGitInfo(dir);
    expect(info.isGitRepo).toBe(false);
    expect(info.remoteUrl).toBeNull();
    expect(info.githubOwner).toBeNull();
    expect(info.githubRepo).toBeNull();
    expect(info.projectName).toBeNull();
  });

  it("returns isGitRepo=true for git-initialized directory", () => {
    initGit(dir);
    const info = detectGitInfo(dir);
    expect(info.isGitRepo).toBe(true);
  });

  it("parses HTTPS GitHub remote URL", () => {
    initGit(dir, "https://github.com/TestUser/my-repo.git");
    const info = detectGitInfo(dir);
    expect(info.isGitRepo).toBe(true);
    expect(info.githubOwner).toBe("TestUser");
    expect(info.githubRepo).toBe("my-repo");
    expect(info.projectName).toBe("my-repo");
  });

  it("parses SSH GitHub remote URL", () => {
    initGit(dir, "git@github.com:TestUser/my-repo.git");
    const info = detectGitInfo(dir);
    expect(info.githubOwner).toBe("TestUser");
    expect(info.githubRepo).toBe("my-repo");
  });

  it("parses HTTPS URL without .git suffix", () => {
    initGit(dir, "https://github.com/Owner/repo");
    const info = detectGitInfo(dir);
    expect(info.githubOwner).toBe("Owner");
    expect(info.githubRepo).toBe("repo");
  });

  it("returns null owner/repo for non-GitHub remote", () => {
    initGit(dir, "https://gitlab.com/user/repo.git");
    const info = detectGitInfo(dir);
    expect(info.isGitRepo).toBe(true);
    expect(info.remoteUrl).toBe("https://gitlab.com/user/repo.git");
    expect(info.githubOwner).toBeNull();
    expect(info.githubRepo).toBeNull();
  });

  it("returns null remote when no origin set", () => {
    initGit(dir);
    const info = detectGitInfo(dir);
    expect(info.remoteUrl).toBeNull();
    expect(info.githubOwner).toBeNull();
  });
});
