import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, existsSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import {
  createTestProject,
  initGit,
  cleanupTestProject,
  makeConfig,
} from "../helpers.js";
import { runGenerators } from "../../src/commands/init.js";
import { getLanguageHooks } from "../../src/detectors/language-hooks.js";

describe("matrix: Java project", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestProject("java");
    initGit(dir);
  });

  afterEach(() => {
    cleanupTestProject(dir);
  });

  function javaConfig(
    overrides: Partial<Parameters<typeof makeConfig>[1]> = {},
  ) {
    return makeConfig(dir, {
      language: "java",
      framework: "spring-boot",
      buildTool: "gradle",
      buildCommand: "gradle build -x test",
      testCommand: "gradle test",
      lintCommand: "gradle checkstyleMain",
      formatCommand: 'echo "no formatter configured"',
      tools: ["claude", "codex"],
      useGitHub: true,
      githubOwner: "test-owner",
      githubRepo: "test-repo",
      languageHooks: getLanguageHooks("java"),
      ...overrides,
    });
  }

  it("generates AGENTS.md mentioning Java", () => {
    const config = javaConfig();
    runGenerators(config);
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(content).toContain("java");
  });

  it("AGENTS.md mentions spring-boot framework", () => {
    const config = javaConfig();
    runGenerators(config);
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(content).toContain("spring-boot");
  });

  it("AGENTS.md includes hexagonal architecture invariant", () => {
    const config = javaConfig();
    runGenerators(config);
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(content).toContain("Hexagonal architecture");
    expect(content).toContain("domain must not import from adapters");
  });

  it("CI workflow uses gradle commands", () => {
    const config = javaConfig();
    runGenerators(config);
    const ci = readFileSync(
      join(dir, ".github", "workflows", "ci.yml"),
      "utf-8",
    );
    expect(ci).toContain("gradlew checkstyleMain");
    expect(ci).toContain("gradlew test");
    expect(ci).toContain("setup-java");
  });

  it("check-all.mjs references gradlew", () => {
    const config = javaConfig();
    runGenerators(config);
    const checkAll = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(checkAll).toContain("gradlew");
    expect(checkAll).toContain("checkstyleMain");
  });

  it("does not include TypeScript-specific hooks", () => {
    const config = javaConfig();
    runGenerators(config);
    expect(existsSync(join(dir, ".claude", "hooks", "check-no-any.mjs"))).toBe(
      false,
    );
  });

  it("AGENTS.md coding standards are Java-specific", () => {
    const config = javaConfig();
    runGenerators(config);
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(content).toContain("constructor injection");
    expect(content).toContain("Records for immutable data transfer");
    // Should NOT contain TypeScript standards
    expect(content).not.toContain("Strict mode always on");
    expect(content).not.toContain(".unwrap()");
  });

  it("generates config/pmd-ruleset.xml when enableDebtGates is true", () => {
    const config = javaConfig({ enableDebtGates: true });
    runGenerators(config);
    expect(existsSync(join(dir, "config", "pmd-ruleset.xml"))).toBe(true);
  });

  it("pmd-ruleset.xml not generated when enableDebtGates is false", () => {
    const config = javaConfig({ enableDebtGates: false });
    runGenerators(config);
    expect(existsSync(join(dir, "config", "pmd-ruleset.xml"))).toBe(false);
  });

  it("check-all.mjs includes jacocoTestCoverageVerification and pmdMain when enableDebtGates is true", () => {
    const config = javaConfig({ enableDebtGates: true });
    runGenerators(config);
    const checkAll = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(checkAll).toContain("jacocoTestCoverageVerification");
    expect(checkAll).toContain("pmdMain");
  });

  it("CI workflow includes debt-gates job for Java/Gradle when enableDebtGates is true", () => {
    const config = javaConfig({ enableDebtGates: true });
    runGenerators(config);
    const ci = readFileSync(
      join(dir, ".github", "workflows", "ci.yml"),
      "utf-8",
    );
    expect(ci).toContain("debt-gates:");
  });

  it("settings.json includes gradle permissions", () => {
    const config = javaConfig();
    runGenerators(config);
    const settings = JSON.parse(
      readFileSync(join(dir, ".claude", "settings.json"), "utf-8"),
    ) as Record<string, unknown>;
    const permissions = settings["permissions"] as { allow?: string[] };
    expect(permissions.allow).toEqual(
      expect.arrayContaining(["Bash(./gradlew *)"]),
    );
    // Should NOT contain npm permissions
    expect(permissions.allow).not.toEqual(
      expect.arrayContaining(["Bash(npm run *)"]),
    );
  });
});

describe("matrix: Java project (Maven)", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestProject("java");
    // Replace build.gradle with pom.xml to simulate Maven project
    unlinkSync(join(dir, "build.gradle"));
    writeFileSync(
      join(dir, "pom.xml"),
      "<project><modelVersion>4.0.0</modelVersion><artifactId>test</artifactId></project>",
    );
    initGit(dir);
  });

  afterEach(() => {
    cleanupTestProject(dir);
  });

  function mavenConfig(
    overrides: Partial<Parameters<typeof makeConfig>[1]> = {},
  ) {
    return makeConfig(dir, {
      language: "java",
      framework: null,
      buildTool: "maven",
      buildCommand: "mvn package -DskipTests",
      testCommand: "mvn test",
      lintCommand: "mvn checkstyle:check",
      formatCommand: 'echo "no formatter configured"',
      tools: ["claude", "codex"],
      useGitHub: true,
      githubOwner: "test-owner",
      githubRepo: "test-repo",
      languageHooks: getLanguageHooks("java"),
      ...overrides,
    });
  }

  it("CI workflow uses mvn commands, not gradlew", () => {
    const config = mavenConfig();
    runGenerators(config);
    const ci = readFileSync(
      join(dir, ".github", "workflows", "ci.yml"),
      "utf-8",
    );
    expect(ci).toContain("mvn");
    expect(ci).toContain("setup-java");
    expect(ci).not.toContain("gradlew");
    expect(ci).not.toContain("setup-gradle");
  });

  it("check-all.mjs references mvn commands", () => {
    const config = mavenConfig();
    runGenerators(config);
    const checkAll = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(checkAll).toContain("mvn");
    expect(checkAll).not.toContain("gradlew");
  });

  it("settings.json includes maven permissions, not gradle", () => {
    const config = mavenConfig();
    runGenerators(config);
    const settings = JSON.parse(
      readFileSync(join(dir, ".claude", "settings.json"), "utf-8"),
    ) as Record<string, unknown>;
    const permissions = settings["permissions"] as { allow?: string[] };
    expect(permissions.allow).toEqual(expect.arrayContaining(["Bash(mvn *)"]));
    expect(permissions.allow).not.toEqual(
      expect.arrayContaining(["Bash(./gradlew *)"]),
    );
  });

  it("dependabot.yml includes maven ecosystem", () => {
    const config = mavenConfig();
    runGenerators(config);
    const dependabot = readFileSync(
      join(dir, ".github", "dependabot.yml"),
      "utf-8",
    );
    expect(dependabot).toContain("maven");
    expect(dependabot).not.toContain("gradle");
  });
});

// ── M22: Hexagonal Architecture Verification Suite (INV-32 evidence) ───────────

describe("matrix: Java project — hexagonal architecture suite (M22)", () => {
  let hexDir: string;

  beforeEach(() => {
    hexDir = createTestProject("java");
    initGit(hexDir);
  });

  afterEach(() => {
    cleanupTestProject(hexDir);
  });

  function hexConfig(
    overrides: Partial<Parameters<typeof makeConfig>[1]> = {},
  ) {
    return makeConfig(hexDir, {
      language: "java",
      framework: "spring-boot",
      buildTool: "gradle",
      buildCommand: "gradle build -x test",
      testCommand: "gradle test",
      lintCommand: "gradle checkstyleMain",
      formatCommand: 'echo "no formatter configured"',
      tools: ["claude"],
      useGitHub: true,
      githubOwner: "test-owner",
      githubRepo: "test-repo",
      languageHooks: getLanguageHooks("java"),
      architectureStyle: "hexagonal",
      basePackage: "com.example.fixture",
      ...overrides,
    });
  }

  it("emits DomainPurityTest.java in architecture package", () => {
    const config = hexConfig();
    runGenerators(config);
    expect(
      existsSync(
        join(
          hexDir,
          "src",
          "test",
          "java",
          "com",
          "example",
          "fixture",
          "architecture",
          "DomainPurityTest.java",
        ),
      ),
    ).toBe(true);
  });

  it("emits DependencyFlowTest.java in architecture package", () => {
    const config = hexConfig();
    runGenerators(config);
    expect(
      existsSync(
        join(
          hexDir,
          "src",
          "test",
          "java",
          "com",
          "example",
          "fixture",
          "architecture",
          "DependencyFlowTest.java",
        ),
      ),
    ).toBe(true);
  });

  it("emits PortsIndependenceTest.java in architecture package", () => {
    const config = hexConfig();
    runGenerators(config);
    expect(
      existsSync(
        join(
          hexDir,
          "src",
          "test",
          "java",
          "com",
          "example",
          "fixture",
          "architecture",
          "PortsIndependenceTest.java",
        ),
      ),
    ).toBe(true);
  });

  it("emits TestCoverageArchTest.java in architecture package", () => {
    const config = hexConfig();
    runGenerators(config);
    expect(
      existsSync(
        join(
          hexDir,
          "src",
          "test",
          "java",
          "com",
          "example",
          "fixture",
          "architecture",
          "TestCoverageArchTest.java",
        ),
      ),
    ).toBe(true);
  });

  it("emits arch-test-deps.gradle fragment", () => {
    const config = hexConfig();
    runGenerators(config);
    expect(existsSync(join(hexDir, "gradle", "arch-test-deps.gradle"))).toBe(
      true,
    );
  });

  it("emits RestAssuredBaseIT.java + RestAssuredArchTest.java when hasDatabase+hasPublicApi", () => {
    const config = hexConfig({ hasDatabase: true, hasPublicApi: true });
    runGenerators(config);
    expect(
      existsSync(
        join(
          hexDir,
          "src",
          "test",
          "java",
          "com",
          "example",
          "fixture",
          "support",
          "RestAssuredBaseIT.java",
        ),
      ),
    ).toBe(true);
    expect(
      existsSync(
        join(
          hexDir,
          "src",
          "test",
          "java",
          "com",
          "example",
          "fixture",
          "architecture",
          "RestAssuredArchTest.java",
        ),
      ),
    ).toBe(true);
  });

  it("AGENTS.md includes architecture verification section for hexagonal+basePackage", () => {
    const config = hexConfig();
    runGenerators(config);
    const content = readFileSync(join(hexDir, "AGENTS.md"), "utf-8");
    expect(content).toContain("Architecture Verification");
    expect(content).toContain("DomainPurityTest");
    expect(content).toContain("DependencyFlowTest");
  });

  it("check-all.mjs includes architecture tests step for hexagonal Gradle", () => {
    const config = hexConfig();
    runGenerators(config);
    const content = readFileSync(
      join(hexDir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(content).toContain("architecture tests");
  });
});

// ── M23: Java L3 mutation gate (pitest hard gate) ────────────────────────────

describe("matrix: Java L3 mutation gate (pitest)", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestProject("java");
    initGit(dir);
  });

  afterEach(() => {
    cleanupTestProject(dir);
  });

  function javaL3Config(
    overrides: Partial<Parameters<typeof makeConfig>[1]> = {},
  ) {
    return makeConfig(dir, {
      language: "java",
      governanceLevel: "L3",
      buildTool: "gradle",
      useGitHub: true,
      githubOwner: "test-owner",
      githubRepo: "test-repo",
      languageHooks: getLanguageHooks("java"),
      ...overrides,
    });
  }

  it("emits gradle/pitest.gradle at L3", () => {
    const config = javaL3Config();
    runGenerators(config);
    expect(existsSync(join(dir, "gradle", "pitest.gradle"))).toBe(true);
  });

  it("pitest.gradle threshold equals 85", () => {
    const config = javaL3Config();
    runGenerators(config);
    const content = readFileSync(join(dir, "gradle", "pitest.gradle"), "utf-8");
    expect(content).toContain("mutationThreshold = 85");
  });

  it("check-all.mjs does NOT invoke pitest (mutation moved to nightly)", () => {
    const config = javaL3Config();
    runGenerators(config);
    const content = readFileSync(
      join(dir, "scripts", "check-all.mjs"),
      "utf-8",
    );
    expect(content).not.toContain("pitest");
  });

  it("L2 Gradle config does NOT emit pitest.gradle", () => {
    const config = javaL3Config({ governanceLevel: "L2" });
    runGenerators(config);
    expect(existsSync(join(dir, "gradle", "pitest.gradle"))).toBe(false);
  });

  it("AGENTS.md L3 mentions pitest and 85%", () => {
    const config = javaL3Config();
    runGenerators(config);
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(content).toMatch(/pitest|mutation/i);
    expect(content).toContain("85");
  });
});
