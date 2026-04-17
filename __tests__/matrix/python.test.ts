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

describe("matrix: Python project", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestProject("python");
    initGit(dir);
  });

  afterEach(() => {
    cleanupTestProject(dir);
  });

  function pythonConfig(
    overrides: Partial<Parameters<typeof makeConfig>[1]> = {},
  ) {
    return makeConfig(dir, {
      language: "python",
      framework: null,
      buildTool: "pip",
      buildCommand: "pip install -e .",
      testCommand: "pytest",
      lintCommand: "ruff check .",
      formatCommand: "ruff format --check .",
      tools: ["claude", "codex"],
      useGitHub: true,
      githubOwner: "test-owner",
      githubRepo: "test-repo",
      languageHooks: getLanguageHooks("python"),
      ...overrides,
    });
  }

  it("generates AGENTS.md mentioning Python", () => {
    const config = pythonConfig();
    runGenerators(config);
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(content).toContain("python");
  });

  it("AGENTS.md gate system references pytest and ruff commands", () => {
    const config = pythonConfig();
    runGenerators(config);
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(content).toContain("pytest");
    expect(content).toContain("ruff check");
    expect(content).toContain("ruff format");
  });

  it("AGENTS.md does not contain TypeScript/Rust/Java-specific invariants", () => {
    const config = pythonConfig();
    runGenerators(config);
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(content).not.toContain("No `any` type");
    expect(content).not.toContain(".unwrap()");
    expect(content).not.toContain("Hexagonal architecture");
  });

  it("generates all standard files", () => {
    const config = pythonConfig();
    const results = runGenerators(config);
    const paths = results.map((r) => r.path);
    expect(paths.some((p) => p.endsWith("AGENTS.md"))).toBe(true);
    expect(paths.some((p) => p.includes(".claude/CLAUDE.md"))).toBe(true);
    expect(paths.some((p) => p.includes(".agents/CODEX.md"))).toBe(true);
    expect(paths.some((p) => p.includes(".github/workflows/ci.yml"))).toBe(
      true,
    );
  });

  it("settings.json does not include npm or gradle permissions", () => {
    const config = pythonConfig();
    runGenerators(config);
    const settings = JSON.parse(
      readFileSync(join(dir, ".claude", "settings.json"), "utf-8"),
    ) as Record<string, unknown>;
    const permissions = settings["permissions"] as { allow?: string[] };
    expect(permissions.allow).not.toEqual(
      expect.arrayContaining(["Bash(npm run *)"]),
    );
    expect(permissions.allow).not.toEqual(
      expect.arrayContaining(["Bash(./gradlew *)"]),
    );
    expect(permissions.allow).not.toEqual(
      expect.arrayContaining(["Bash(cargo *)"]),
    );
  });

  it("AGENTS.md includes Python coding standards", () => {
    const config = pythonConfig();
    runGenerators(config);
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(content).toContain("Type annotations");
    expect(content).toContain("ruff");
    expect(content).toContain("pytest");
  });

  it("AGENTS.md includes Python invariants INV-04/INV-05", () => {
    const config = pythonConfig();
    runGenerators(config);
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(content).toContain("Type annotations required");
    expect(content).toContain("ruff check");
  });

  it("CI workflow uses Python setup and commands", () => {
    const config = pythonConfig();
    runGenerators(config);
    const ci = readFileSync(
      join(dir, ".github", "workflows", "ci.yml"),
      "utf-8",
    );
    expect(ci).toContain("setup-python");
    expect(ci).toContain("ruff");
    expect(ci).toContain("pytest");
  });

  it("check-all.mjs references Python commands", () => {
    const config = pythonConfig();
    runGenerators(config);
    const checkAll = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(checkAll).toContain("ruff");
    expect(checkAll).toContain("pytest");
  });

  it("settings.json includes Python permissions", () => {
    const config = pythonConfig();
    runGenerators(config);
    const settings = JSON.parse(
      readFileSync(join(dir, ".claude", "settings.json"), "utf-8"),
    ) as Record<string, unknown>;
    const permissions = settings["permissions"] as { allow?: string[] };
    expect(permissions.allow).toEqual(
      expect.arrayContaining([
        "Bash(python *)",
        "Bash(pip *)",
        "Bash(pytest *)",
        "Bash(ruff *)",
      ]),
    );
  });

  it("generates check-no-bare-except.mjs language hook", () => {
    const config = pythonConfig();
    runGenerators(config);
    const hookPath = join(dir, ".claude", "hooks", "check-no-bare-except.mjs");
    expect(existsSync(hookPath)).toBe(true);
    const content = readFileSync(hookPath, "utf-8");
    expect(content).toContain(".py");
  });

  it("check-all.mjs includes pytest cov-fail-under and ruff complexity when enableDebtGates is true", () => {
    const config = pythonConfig({ enableDebtGates: true });
    runGenerators(config);
    const checkAll = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(checkAll).toContain("cov-fail-under");
    expect(checkAll).toContain("C901");
  });

  it("CI workflow includes debt-gates job for Python when enableDebtGates is true", () => {
    const config = pythonConfig({ enableDebtGates: true });
    runGenerators(config);
    const ci = readFileSync(
      join(dir, ".github", "workflows", "ci.yml"),
      "utf-8",
    );
    expect(ci).toContain("debt-gates:");
  });

  it("dependabot.yml includes pip ecosystem", () => {
    const config = pythonConfig();
    runGenerators(config);
    const dependabot = readFileSync(
      join(dir, ".github", "dependabot.yml"),
      "utf-8",
    );
    expect(dependabot).toContain("pip");
  });

  describe("hexagonal architecture variant", () => {
    function hexConfig() {
      return pythonConfig({ architectureStyle: "hexagonal" });
    }

    it("emits .importlinter at project root", () => {
      runGenerators(hexConfig());
      expect(existsSync(join(dir, ".importlinter"))).toBe(true);
    });

    it("emits ruff-boundaries.toml at project root", () => {
      runGenerators(hexConfig());
      expect(existsSync(join(dir, "ruff-boundaries.toml"))).toBe(true);
    });

    it("emits scripts/check-boundaries.mjs", () => {
      runGenerators(hexConfig());
      expect(existsSync(join(dir, "scripts", "check-boundaries.mjs"))).toBe(
        true,
      );
    });

    it(".importlinter contains framework module bans", () => {
      runGenerators(hexConfig());
      const content = readFileSync(join(dir, ".importlinter"), "utf-8");
      expect(content).toContain("sqlalchemy");
      expect(content).toContain("fastapi");
      expect(content).toContain("forbidden");
    });

    it(".importlinter contains layers contract", () => {
      runGenerators(hexConfig());
      const content = readFileSync(join(dir, ".importlinter"), "utf-8");
      expect(content).toContain("type = layers");
      expect(content).toContain("domain");
      expect(content).toContain("adapters");
    });

    it("ruff-boundaries.toml contains TID251 banned-api entries", () => {
      runGenerators(hexConfig());
      const content = readFileSync(join(dir, "ruff-boundaries.toml"), "utf-8");
      expect(content).toContain("TID251");
      expect(content).toContain('"sqlalchemy"');
      expect(content).toContain("banned-api");
    });

    it("AGENTS.md contains Architecture Verification (M22d) section with import-linter", () => {
      runGenerators(hexConfig());
      const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
      expect(content).toContain("Architecture Verification (M22d)");
      expect(content).toContain("import-linter");
    });

    it("check-all.mjs contains boundaries gate step", () => {
      runGenerators(hexConfig());
      const checkAll = readFileSync(
        join(dir, "scripts", "check-all.mjs"),
        "utf-8",
      );
      expect(checkAll).toContain("runCheck('boundaries'");
    });

    it("domain purity grep fails on forbidden import statement, passes on clean domain", () => {
      runGenerators(hexConfig());
      mkdirSync(join(dir, "src", "domain"), { recursive: true });
      writeFileSync(
        join(dir, "src", "domain", "bad.py"),
        "import sqlalchemy\n",
      );

      const fail = spawnSync("node", ["scripts/check-boundaries.mjs"], {
        cwd: dir,
        encoding: "utf-8",
        shell: false,
      });
      expect(fail.status).not.toBe(0);
      expect(fail.stderr).toContain("sqlalchemy");

      rmSync(join(dir, "src", "domain", "bad.py"));

      const pass = spawnSync("node", ["scripts/check-boundaries.mjs"], {
        cwd: dir,
        encoding: "utf-8",
        shell: false,
      });
      expect(pass.stderr ?? "").not.toContain("domain purity violations");
    });

    it("domain purity grep also catches from-import form", () => {
      runGenerators(hexConfig());
      mkdirSync(join(dir, "src", "domain"), { recursive: true });
      writeFileSync(
        join(dir, "src", "domain", "bad.py"),
        "from sqlalchemy.orm import Session\n",
      );

      const fail = spawnSync("node", ["scripts/check-boundaries.mjs"], {
        cwd: dir,
        encoding: "utf-8",
        shell: false,
      });
      expect(fail.status).not.toBe(0);
      expect(fail.stderr).toContain("sqlalchemy");

      rmSync(join(dir, "src", "domain", "bad.py"));
    });

    it("non-hexagonal config does NOT emit .importlinter", () => {
      runGenerators(pythonConfig());
      expect(existsSync(join(dir, ".importlinter"))).toBe(false);
    });

    it("non-hexagonal AGENTS.md does NOT contain M22d section", () => {
      runGenerators(pythonConfig());
      const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
      expect(content).not.toContain("Architecture Verification (M22d)");
    });
  });
});

// ── M23: Python L3 mutation gate (mutmut — beta) ─────────────────────────────

describe("matrix: Python L3 mutation gate (mutmut)", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestProject("python");
    initGit(dir);
  });

  afterEach(() => {
    cleanupTestProject(dir);
  });

  function pythonL3Config(
    overrides: Partial<Parameters<typeof makeConfig>[1]> = {},
  ) {
    return makeConfig(dir, {
      language: "python",
      governanceLevel: "L3",
      useGitHub: true,
      githubOwner: "test-owner",
      githubRepo: "test-repo",
      languageHooks: getLanguageHooks("python"),
      acceptBetaTools: true,
      ...overrides,
    });
  }

  it("emits mutmut-config.toml at L3 when acceptBetaTools=true", () => {
    const config = pythonL3Config();
    runGenerators(config);
    expect(existsSync(join(dir, "mutmut-config.toml"))).toBe(true);
  });

  it("emits scripts/parse-mutmut.py at L3 when acceptBetaTools=true", () => {
    const config = pythonL3Config();
    runGenerators(config);
    expect(existsSync(join(dir, "scripts", "parse-mutmut.py"))).toBe(true);
  });

  it("mutmut-config.toml references project source path", () => {
    const config = pythonL3Config();
    runGenerators(config);
    const content = readFileSync(join(dir, "mutmut-config.toml"), "utf-8");
    expect(content).toMatch(/paths_to_mutate|src/);
  });

  it("check-all.mjs invokes mutmut at L3", () => {
    const config = pythonL3Config();
    runGenerators(config);
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(content).toContain("mutmut");
  });

  it("L2 config does NOT emit mutmut-config.toml", () => {
    const config = pythonL3Config({ governanceLevel: "L2" });
    runGenerators(config);
    expect(existsSync(join(dir, "mutmut-config.toml"))).toBe(false);
  });

  it("throws beta error when acceptBetaTools=false at L3", () => {
    const config = pythonL3Config({ acceptBetaTools: false });
    expect(() => runGenerators(config)).toThrow(/beta/i);
  });

  it("throws beta error when acceptBetaTools not set at L3", () => {
    const config = pythonL3Config({ acceptBetaTools: undefined });
    expect(() => runGenerators(config)).toThrow(/beta/i);
  });

  it("AGENTS.md L3 mentions mutmut and 85%", () => {
    const config = pythonL3Config();
    runGenerators(config);
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(content).toMatch(/mutmut|mutation/i);
    expect(content).toContain("85");
  });
});
