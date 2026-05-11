import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  createTestProject,
  cleanupTestProject,
  makeConfig,
} from "../helpers.js";
import { generateGithubSetup } from "../../src/generators/github-setup.js";

describe("generateGithubSetup", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestProject("typescript");
  });

  afterEach(() => {
    cleanupTestProject(dir);
  });

  it("writes scripts/setup-repo.sh when useGitHub=true and L2", () => {
    const config = makeConfig(dir, { useGitHub: true, governanceLevel: "L2" });
    const result = generateGithubSetup(config);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toContain("setup-repo.sh");
    expect(result.files[0].action).toBe("created");
    expect(existsSync(join(dir, "scripts", "setup-repo.sh"))).toBe(true);
  });

  it("returns empty files when useGitHub=false", () => {
    const config = makeConfig(dir, { useGitHub: false, governanceLevel: "L2" });
    const result = generateGithubSetup(config);
    expect(result.files).toHaveLength(0);
  });

  it("returns empty files when governanceLevel=L1", () => {
    const config = makeConfig(dir, { useGitHub: true, governanceLevel: "L1" });
    const result = generateGithubSetup(config);
    expect(result.files).toHaveLength(0);
    expect(existsSync(join(dir, "scripts", "setup-repo.sh"))).toBe(false);
  });

  it("skips write on second invocation (idempotent via skipIfExists)", () => {
    const config = makeConfig(dir, { useGitHub: true, governanceLevel: "L2" });
    generateGithubSetup(config);
    const second = generateGithubSetup(config);
    expect(second.files[0].action).toBe("skipped");
  });

  it("places script under scripts/ directory at project root", () => {
    const config = makeConfig(dir, { useGitHub: true, governanceLevel: "L2" });
    generateGithubSetup(config);
    expect(existsSync(join(dir, "scripts", "setup-repo.sh"))).toBe(true);
  });
});
