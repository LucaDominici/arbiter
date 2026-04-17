import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Language, ProjectConfig } from "../src/wizard/types.js";
import {
  presetToTiers,
  defaultPresetForLevel,
} from "../src/invariants/filter.js";

/**
 * Create a temp directory with language-specific marker files.
 */
export function createTestProject(language: Language = "unknown"): string {
  const dir = mkdtempSync(join(tmpdir(), `arbiter-test-${language}-`));

  switch (language) {
    case "typescript":
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({
          name: "test-project",
          scripts: { build: "tsc", test: "vitest run", lint: "eslint ." },
          devDependencies: {
            typescript: "^5.0.0",
            eslint: "^9.0.0",
            prettier: "^3.0.0",
          },
        }),
      );
      break;
    case "java":
      writeFileSync(join(dir, "build.gradle"), 'plugins { id "java" }');
      break;
    case "rust":
      writeFileSync(
        join(dir, "Cargo.toml"),
        '[package]\nname = "test"\nversion = "0.1.0"',
      );
      break;
    case "go":
      writeFileSync(join(dir, "go.mod"), "module example.com/test\n\ngo 1.22");
      break;
    case "python":
      writeFileSync(join(dir, "pyproject.toml"), '[project]\nname = "test"');
      break;
  }

  return dir;
}

/**
 * Initialize a git repo in the given directory.
 */
export function initGit(dir: string, remote?: string): void {
  execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@arbiter.dev"], {
    cwd: dir,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.name", "Arbiter Test"], {
    cwd: dir,
    stdio: "ignore",
  });
  if (remote) {
    execFileSync("git", ["remote", "add", "origin", remote], {
      cwd: dir,
      stdio: "ignore",
    });
  }
}

/**
 * Remove a test project directory.
 */
export function cleanupTestProject(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/**
 * Build a ProjectConfig fixture with sensible defaults.
 * Pass overrides for any field you need to vary.
 */
export function makeConfig(
  dir: string,
  overrides: Partial<ProjectConfig> = {},
): ProjectConfig {
  const governanceLevel = overrides.governanceLevel ?? "L2";
  return {
    targetDir: dir,
    projectName: "test-project",
    description: "Test project",
    language: "typescript",
    framework: null,
    archetype: "library",
    architectureStyle: "none",
    isMultiTenant: false,
    hasDatabase: false,
    hasPublicApi: false,
    buildTool: "npm",
    buildCommand: "npm run build",
    testCommand: "npm test",
    lintCommand: "npm run lint",
    formatCommand: "npx prettier --check .",
    tools: ["claude", "codex"],
    governanceLevel,
    useGitHub: false,
    githubOwner: null,
    githubRepo: null,
    existing: {
      agentsMd: false,
      claudeDir: false,
      agentsDir: false,
      aiRulez: false,
      settingsJson: false,
      checkAllScript: false,
    },
    languageHooks: [],
    enableDebtGates: governanceLevel !== "L1",
    enableSuppressions: true,
    enableSecurityScanning: governanceLevel !== "L1",
    invariantTiers: presetToTiers(defaultPresetForLevel(governanceLevel)),
    basePackage: undefined,
    contractType: "none",
    ...overrides,
  };
}
