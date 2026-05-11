import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  createTestProject,
  initGit,
  cleanupTestProject,
  makeConfig,
} from "../helpers.js";
import { runGenerators } from "../../src/commands/init.js";
import { getLanguageHooks } from "../../src/detectors/language-hooks.js";

describe("matrix: TypeScript project", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestProject("typescript");
    initGit(dir);
  });

  afterEach(() => {
    cleanupTestProject(dir);
  });

  function tsConfig(overrides: Partial<Parameters<typeof makeConfig>[1]> = {}) {
    return makeConfig(dir, {
      language: "typescript",
      framework: null,
      buildTool: "npm",
      buildCommand: "npm run build",
      testCommand: "npm test",
      lintCommand: "npm run lint",
      formatCommand: "npx prettier --check .",
      tools: ["claude", "codex"],
      useGitHub: true,
      githubOwner: "test-owner",
      githubRepo: "test-repo",
      languageHooks: getLanguageHooks("typescript"),
      ...overrides,
    });
  }

  it("generates AGENTS.md mentioning TypeScript", () => {
    const config = tsConfig();
    runGenerators(config);
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(content).toContain("typescript");
  });

  it("AGENTS.md includes no-any invariant for TypeScript", () => {
    const config = tsConfig();
    runGenerators(config);
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(content).toContain("No `any` type");
  });

  it("CI workflow uses npm commands", () => {
    const config = tsConfig();
    runGenerators(config);
    const ci = readFileSync(
      join(dir, ".github", "workflows", "ci.yml"),
      "utf-8",
    );
    expect(ci).toContain("npm ci");
    expect(ci).toContain("npm run lint");
    expect(ci).toContain("test:unit");
  });

  it("CI workflow sets up Node.js", () => {
    const config = tsConfig();
    runGenerators(config);
    const ci = readFileSync(
      join(dir, ".github", "workflows", "ci.yml"),
      "utf-8",
    );
    expect(ci).toContain("setup-node");
    expect(ci).toContain("node-version: '20'");
  });

  it("check-all.mjs references eslint and prettier", () => {
    const config = tsConfig();
    runGenerators(config);
    const checkAll = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(checkAll).toContain("eslint");
    expect(checkAll).toContain("prettier");
  });

  it("generates check-no-any.mjs language hook", () => {
    const config = tsConfig();
    runGenerators(config);
    expect(existsSync(join(dir, ".claude", "hooks", "check-no-any.mjs"))).toBe(
      true,
    );
    const hook = readFileSync(
      join(dir, ".claude", "hooks", "check-no-any.mjs"),
      "utf-8",
    );
    expect(hook).toContain("any");
  });

  it("settings.json includes npm permissions", () => {
    const config = tsConfig();
    runGenerators(config);
    const settings = JSON.parse(
      readFileSync(join(dir, ".claude", "settings.json"), "utf-8"),
    ) as Record<string, unknown>;
    const permissions = settings["permissions"] as { allow?: string[] };
    expect(permissions.allow).toEqual(
      expect.arrayContaining(["Bash(npm run *)"]),
    );
  });

  it("generates knip.json when enableDebtGates is true", () => {
    const config = tsConfig({ enableDebtGates: true });
    runGenerators(config);
    expect(existsSync(join(dir, "knip.json"))).toBe(true);
  });

  it("knip.json not generated when enableDebtGates is false", () => {
    const config = tsConfig({ enableDebtGates: false });
    runGenerators(config);
    expect(existsSync(join(dir, "knip.json"))).toBe(false);
  });

  it("check-all.mjs includes knip and madge when enableDebtGates is true", () => {
    const config = tsConfig({ enableDebtGates: true });
    runGenerators(config);
    const checkAll = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(checkAll).toContain("knip");
    expect(checkAll).toContain("madge");
  });

  it("CI workflow includes debt-gates job when enableDebtGates is true", () => {
    const config = tsConfig({ enableDebtGates: true });
    runGenerators(config);
    const ci = readFileSync(
      join(dir, ".github", "workflows", "ci.yml"),
      "utf-8",
    );
    expect(ci).toContain("debt-gates:");
  });

  it("settings.json includes check-no-any.mjs hook entry", () => {
    const config = tsConfig();
    runGenerators(config);
    const raw = readFileSync(join(dir, ".claude", "settings.json"), "utf-8");
    expect(raw).toContain("check-no-any.mjs");
  });

  it("generates check-no-placeholders.mjs static hook (#151)", () => {
    const config = tsConfig();
    runGenerators(config);
    expect(
      existsSync(join(dir, ".claude", "hooks", "check-no-placeholders.mjs")),
    ).toBe(true);
    const hook = readFileSync(
      join(dir, ".claude", "hooks", "check-no-placeholders.mjs"),
      "utf-8",
    );
    expect(hook).toContain("PLACEHOLDER");
  });

  it("settings.json includes check-no-placeholders.mjs hook entry (#151)", () => {
    const config = tsConfig();
    runGenerators(config);
    const raw = readFileSync(join(dir, ".claude", "settings.json"), "utf-8");
    expect(raw).toContain("check-no-placeholders.mjs");
  });

  it("generates check-no-unused-exports.mjs hook for TypeScript (#156)", () => {
    const config = tsConfig();
    runGenerators(config);
    expect(
      existsSync(join(dir, ".claude", "hooks", "check-no-unused-exports.mjs")),
    ).toBe(true);
    const hook = readFileSync(
      join(dir, ".claude", "hooks", "check-no-unused-exports.mjs"),
      "utf-8",
    );
    expect(hook).toContain("knip");
  });

  it("settings.json includes check-no-unused-exports.mjs hook entry for TypeScript (#156)", () => {
    const config = tsConfig();
    runGenerators(config);
    const raw = readFileSync(join(dir, ".claude", "settings.json"), "utf-8");
    expect(raw).toContain("check-no-unused-exports.mjs");
  });

  it("AGENTS.md coding standards section is TypeScript-specific", () => {
    const config = tsConfig();
    runGenerators(config);
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(content).toContain("Strict mode always on");
    expect(content).toContain("kebab-case.ts");
    // Should NOT contain Java or Rust standards, and no M22a hexagonal block for non-hexagonal config
    expect(content).not.toContain("Hexagonal architecture");
    expect(content).not.toContain(".unwrap()");
    expect(content).not.toContain("Architecture Verification (M22a)");
  });

  describe("hexagonal architecture variant", () => {
    function hexConfig() {
      return tsConfig({ architectureStyle: "hexagonal" });
    }

    it("emits .eslintrc-boundaries.cjs at project root", () => {
      runGenerators(hexConfig());
      expect(existsSync(join(dir, ".eslintrc-boundaries.cjs"))).toBe(true);
    });

    it("emits scripts/check-boundaries.mjs at project root", () => {
      runGenerators(hexConfig());
      expect(existsSync(join(dir, "scripts", "check-boundaries.mjs"))).toBe(
        true,
      );
    });

    it("check-all.mjs calls node scripts/check-boundaries.mjs for boundaries gate", () => {
      runGenerators(hexConfig());
      const checkAll = readFileSync(
        join(dir, "scripts", "check-all.mjs"),
        "utf-8",
      );
      expect(checkAll).toContain("check-boundaries.mjs");
    });

    it(".eslintrc-boundaries.cjs contains boundaries/element-types and domain layers", () => {
      runGenerators(hexConfig());
      const content = readFileSync(
        join(dir, ".eslintrc-boundaries.cjs"),
        "utf-8",
      );
      expect(content).toContain("boundaries/element-types");
      expect(content).toContain("domain");
      expect(content).toContain("adapters");
      expect(content).toContain("infrastructure");
    });

    it("AGENTS.md contains Architecture Verification (M22a) section", () => {
      runGenerators(hexConfig());
      const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
      expect(content).toContain("Architecture Verification (M22a)");
      expect(content).toContain("eslint-plugin-boundaries");
    });

    it("check-all.mjs contains boundaries gate step", () => {
      runGenerators(hexConfig());
      const checkAll = readFileSync(
        join(dir, "scripts", "check-all.mjs"),
        "utf-8",
      );
      expect(checkAll).toContain("runCheck('boundaries'");
    });

    it("non-hexagonal config does NOT emit .eslintrc-boundaries.cjs", () => {
      runGenerators(tsConfig());
      expect(existsSync(join(dir, ".eslintrc-boundaries.cjs"))).toBe(false);
    });

    it("non-hexagonal AGENTS.md does NOT contain M22a section", () => {
      runGenerators(tsConfig());
      const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
      expect(content).not.toContain("Architecture Verification (M22a)");
    });
  });
});

// ── M23: TypeScript L3 mutation gate (Stryker) ───────────────────────────────

describe("matrix: TypeScript L3 mutation gate (Stryker)", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestProject("typescript");
    initGit(dir);
  });

  afterEach(() => {
    cleanupTestProject(dir);
  });

  function tsL3Config(
    overrides: Partial<Parameters<typeof makeConfig>[1]> = {},
  ) {
    return makeConfig(dir, {
      language: "typescript",
      governanceLevel: "L3",
      buildTool: "npm",
      useGitHub: true,
      githubOwner: "test-owner",
      githubRepo: "test-repo",
      languageHooks: getLanguageHooks("typescript"),
      ...overrides,
    });
  }

  it("emits stryker.conf.json at L3", () => {
    const config = tsL3Config();
    runGenerators(config);
    expect(existsSync(join(dir, "stryker.conf.json"))).toBe(true);
  });

  it("stryker.conf.json threshold equals 85", () => {
    const config = tsL3Config();
    runGenerators(config);
    const content = readFileSync(join(dir, "stryker.conf.json"), "utf-8");
    expect(content).toContain("85");
    expect(content).toContain("vitest");
  });

  it("check-all.mjs does NOT invoke stryker (mutation moved to nightly)", () => {
    const config = tsL3Config();
    runGenerators(config);
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(content).not.toContain("stryker");
  });

  it("L2 config does NOT emit stryker.conf.json", () => {
    const config = tsL3Config({ governanceLevel: "L2" });
    runGenerators(config);
    expect(existsSync(join(dir, "stryker.conf.json"))).toBe(false);
  });

  it("AGENTS.md L3 mentions stryker and 85%", () => {
    const config = tsL3Config();
    runGenerators(config);
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(content).toMatch(/stryker/i);
    expect(content).toContain("85");
  });
});
