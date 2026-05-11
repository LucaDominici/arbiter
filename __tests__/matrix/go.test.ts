import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
  createTestProject,
  initGit,
  cleanupTestProject,
  makeConfig,
} from "../helpers.js";
import { runGenerators } from "../../src/commands/init.js";
import { getLanguageHooks } from "../../src/detectors/language-hooks.js";

describe("matrix: Go project", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestProject("go");
    initGit(dir);
  });

  afterEach(() => {
    cleanupTestProject(dir);
  });

  function goConfig(overrides: Partial<Parameters<typeof makeConfig>[1]> = {}) {
    return makeConfig(dir, {
      language: "go",
      framework: null,
      buildTool: "go",
      buildCommand: "go build ./...",
      testCommand: "go test ./...",
      lintCommand: "golangci-lint run",
      formatCommand: "gofmt -l .",
      tools: ["claude", "codex"],
      useGitHub: true,
      githubOwner: "test-owner",
      githubRepo: "test-repo",
      languageHooks: getLanguageHooks("go"),
      ...overrides,
    });
  }

  it("generates AGENTS.md mentioning Go", () => {
    const config = goConfig();
    runGenerators(config);
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(content).toContain("go");
  });

  it("AGENTS.md gate system references go commands", () => {
    const config = goConfig();
    runGenerators(config);
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(content).toContain("golangci-lint run");
    expect(content).toContain("go test ./...");
  });

  it("AGENTS.md does not contain TypeScript/Rust/Java-specific invariants", () => {
    const config = goConfig();
    runGenerators(config);
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    // Go doesn't have language-specific invariants in the template
    expect(content).not.toContain("No `any` type");
    expect(content).not.toContain(".unwrap()");
    expect(content).not.toContain("Hexagonal architecture");
  });

  it("generates all standard files (AGENTS.md, .claude/, .agents/, GitHub)", () => {
    const config = goConfig();
    const results = runGenerators(config);
    const paths = results.map((r) => r.path);
    expect(paths.some((p) => p.endsWith("AGENTS.md"))).toBe(true);
    expect(paths.some((p) => p.includes(".claude/CLAUDE.md"))).toBe(true);
    expect(paths.some((p) => p.includes(".agents/CODEX.md"))).toBe(true);
    expect(paths.some((p) => p.includes(".github/workflows/ci.yml"))).toBe(
      true,
    );
  });

  it("CODEX.md and CLAUDE.md are thin pointers referencing AGENTS.md", () => {
    const config = goConfig();
    runGenerators(config);
    const claude = readFileSync(join(dir, ".claude", "CLAUDE.md"), "utf-8");
    const codex = readFileSync(join(dir, ".agents", "CODEX.md"), "utf-8");
    expect(claude).toContain("AGENTS.md");
    expect(codex).toContain("AGENTS.md");
  });

  it("AGENTS.md includes Go coding standards", () => {
    const config = goConfig();
    runGenerators(config);
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(content).toContain("gofmt");
    expect(content).toContain("error handling");
    expect(content).toContain("golangci-lint");
  });

  it("AGENTS.md includes Go invariants INV-04/INV-05", () => {
    const config = goConfig();
    runGenerators(config);
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(content).toContain("error handling");
    expect(content).toContain("golangci-lint");
  });

  it("CI workflow uses Go setup and commands", () => {
    const config = goConfig();
    runGenerators(config);
    const ci = readFileSync(
      join(dir, ".github", "workflows", "ci.yml"),
      "utf-8",
    );
    expect(ci).toContain("setup-go");
    expect(ci).toContain("golangci-lint");
    expect(ci).toContain("go test");
  });

  it("check-all.mjs references Go commands", () => {
    const config = goConfig();
    runGenerators(config);
    const checkAll = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(checkAll).toContain("vet");
    expect(checkAll).toContain("golangci-lint");
    expect(checkAll).toContain("'go'");
  });

  it("settings.json includes Go permissions", () => {
    const config = goConfig();
    runGenerators(config);
    const settings = JSON.parse(
      readFileSync(join(dir, ".claude", "settings.json"), "utf-8"),
    ) as Record<string, unknown>;
    const permissions = settings["permissions"] as { allow?: string[] };
    expect(permissions.allow).toEqual(
      expect.arrayContaining(["Bash(go *)", "Bash(golangci-lint *)"]),
    );
  });

  it("generates check-no-unchecked-err.mjs language hook", () => {
    const config = goConfig();
    runGenerators(config);
    const hookPath = join(
      dir,
      ".claude",
      "hooks",
      "check-no-unchecked-err.mjs",
    );
    expect(existsSync(hookPath)).toBe(true);
    const content = readFileSync(hookPath, "utf-8");
    expect(content).toContain(".go");
  });

  it("generates .golangci.yml when enableDebtGates is true", () => {
    const config = goConfig({ enableDebtGates: true });
    runGenerators(config);
    expect(existsSync(join(dir, ".golangci.yml"))).toBe(true);
  });

  it(".golangci.yml not generated when enableDebtGates is false", () => {
    const config = goConfig({ enableDebtGates: false });
    runGenerators(config);
    expect(existsSync(join(dir, ".golangci.yml"))).toBe(false);
  });

  it("check-all.mjs includes gocyclo and unused when enableDebtGates is true", () => {
    const config = goConfig({ enableDebtGates: true });
    runGenerators(config);
    const checkAll = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(checkAll).toContain("gocyclo");
    expect(checkAll).toContain("unused");
  });

  it("CI workflow includes debt-gates job for Go when enableDebtGates is true", () => {
    const config = goConfig({ enableDebtGates: true });
    runGenerators(config);
    const ci = readFileSync(
      join(dir, ".github", "workflows", "ci.yml"),
      "utf-8",
    );
    expect(ci).toContain("debt-gates:");
  });

  it("dependabot.yml includes gomod ecosystem", () => {
    const config = goConfig();
    runGenerators(config);
    const dependabot = readFileSync(
      join(dir, ".github", "dependabot.yml"),
      "utf-8",
    );
    expect(dependabot).toContain("gomod");
  });

  it("check-all.mjs includes gofmt format gate (#157)", () => {
    const config = goConfig();
    runGenerators(config);
    const checkAll = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(checkAll).toContain("gofmt");
    expect(checkAll).toContain("'-l'");
  });

  describe("hexagonal architecture variant", () => {
    function hexConfig() {
      return goConfig({ architectureStyle: "hexagonal" });
    }

    it("emits .golangci-boundaries.yml at project root", () => {
      runGenerators(hexConfig());
      expect(existsSync(join(dir, ".golangci-boundaries.yml"))).toBe(true);
    });

    it("emits scripts/check-boundaries.mjs", () => {
      runGenerators(hexConfig());
      expect(existsSync(join(dir, "scripts", "check-boundaries.mjs"))).toBe(
        true,
      );
    });

    it(".golangci-boundaries.yml contains framework bans (gorm + gin) scoped away from adapters", () => {
      runGenerators(hexConfig());
      const content = readFileSync(
        join(dir, ".golangci-boundaries.yml"),
        "utf-8",
      );
      expect(content).toContain('version: "2"');
      expect(content).toContain("default: none");
      expect(content).toContain("gorm");
      expect(content).toContain("gin");
      expect(content).toContain("!**/internal/adapter/**");
    });

    it("AGENTS.md contains Architecture Verification (M22c) section with depguard", () => {
      runGenerators(hexConfig());
      const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
      expect(content).toContain("Architecture Verification (M22c)");
      expect(content).toContain("depguard");
    });

    it("check-all.mjs contains boundaries gate step", () => {
      runGenerators(hexConfig());
      const checkAll = readFileSync(
        join(dir, "scripts", "check-all.mjs"),
        "utf-8",
      );
      expect(checkAll).toContain("runCheck('boundaries'");
    });

    it("domain purity grep fails on forbidden import, passes on clean domain", () => {
      runGenerators(hexConfig());
      mkdirSync(join(dir, "internal", "domain"), { recursive: true });
      writeFileSync(
        join(dir, "internal", "domain", "bad.go"),
        'import "gorm.io/gorm"\n',
      );

      const fail = spawnSync("node", ["scripts/check-boundaries.mjs"], {
        cwd: dir,
        encoding: "utf-8",
        shell: false,
      });
      expect(fail.status).not.toBe(0);
      expect(fail.stderr).toContain("gorm");

      rmSync(join(dir, "internal", "domain", "bad.go"));

      const pass = spawnSync("node", ["scripts/check-boundaries.mjs"], {
        cwd: dir,
        encoding: "utf-8",
        shell: false,
      });
      expect(pass.stderr ?? "").not.toContain("domain purity violations");
    });

    it("domain purity grep also catches grouped import syntax", () => {
      runGenerators(hexConfig());
      mkdirSync(join(dir, "internal", "domain"), { recursive: true });
      writeFileSync(
        join(dir, "internal", "domain", "bad.go"),
        'import (\n  "gorm.io/gorm"\n)\n',
      );

      const fail = spawnSync("node", ["scripts/check-boundaries.mjs"], {
        cwd: dir,
        encoding: "utf-8",
        shell: false,
      });
      expect(fail.status).not.toBe(0);
      expect(fail.stderr).toContain("gorm");

      rmSync(join(dir, "internal", "domain", "bad.go"));
    });

    it("non-hexagonal config does NOT emit .golangci-boundaries.yml", () => {
      runGenerators(goConfig());
      expect(existsSync(join(dir, ".golangci-boundaries.yml"))).toBe(false);
    });

    it("non-hexagonal AGENTS.md does NOT contain M22c section", () => {
      runGenerators(goConfig());
      const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
      expect(content).not.toContain("Architecture Verification (M22c)");
    });
  });
});

// ── Go has no mutation gate (go-mutesting = unsafe in matrix) ────────────────

describe("matrix: Go mutation omission (go-mutesting = unsafe)", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestProject("go");
    initGit(dir);
  });

  afterEach(() => {
    cleanupTestProject(dir);
  });

  function goMutConfig(
    overrides: Partial<Parameters<typeof makeConfig>[1]> = {},
  ) {
    return makeConfig(dir, {
      language: "go",
      framework: null,
      buildTool: "go",
      buildCommand: "go build ./...",
      testCommand: "go test ./...",
      lintCommand: "golangci-lint run",
      formatCommand: "gofmt -l .",
      tools: ["claude"],
      useGitHub: true,
      githubOwner: "test-owner",
      githubRepo: "test-repo",
      languageHooks: getLanguageHooks("go"),
      ...overrides,
    });
  }

  it("check-all.mjs does NOT reference go-mutesting at L1", () => {
    const config = goMutConfig({ governanceLevel: "L1" });
    runGenerators(config);
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(content).not.toContain("go-mutesting");
    expect(content).not.toContain("mutesting");
  });

  it("check-all.mjs does NOT reference go-mutesting at L2", () => {
    const config = goMutConfig({ governanceLevel: "L2" });
    runGenerators(config);
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(content).not.toContain("go-mutesting");
    expect(content).not.toContain("mutesting");
  });

  it("throws unsafe error at L3 even with acceptBetaTools (go-mutesting = unsafe, not beta)", () => {
    const config = goMutConfig({
      governanceLevel: "L3",
      acceptBetaTools: true,
    });
    expect(() => runGenerators(config)).toThrow(/unsafe/i);
  });

  it("no go-mutesting config file emitted at L1", () => {
    runGenerators(goMutConfig({ governanceLevel: "L1" }));
    expect(existsSync(join(dir, "go-mutesting.toml"))).toBe(false);
    expect(existsSync(join(dir, ".go-mutesting"))).toBe(false);
  });

  it("no go-mutesting config file emitted at L2", () => {
    runGenerators(goMutConfig({ governanceLevel: "L2" }));
    expect(existsSync(join(dir, "go-mutesting.toml"))).toBe(false);
    expect(existsSync(join(dir, ".go-mutesting"))).toBe(false);
  });

  it("throws unsafe error at L3 — go-mutesting is abandoned upstream, --accept-beta-tools does not override", () => {
    expect(() =>
      runGenerators(
        goMutConfig({ governanceLevel: "L3", acceptBetaTools: true }),
      ),
    ).toThrow(/unsafe/i);
  });
});
