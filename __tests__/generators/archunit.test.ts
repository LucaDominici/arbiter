import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createTestProject,
  cleanupTestProject,
  makeConfig,
} from "../helpers.js";
import { generateArchUnit } from "../../src/generators/archunit.js";

let dir: string;

beforeEach(() => {
  dir = createTestProject("java");
});

afterEach(() => {
  cleanupTestProject(dir);
});

describe("generateArchUnit", () => {
  it("generates NoMockMvcTest.java for Java projects", () => {
    const config = makeConfig(dir, { language: "java", buildTool: "gradle" });
    const result = generateArchUnit(config);
    expect(result.files.length).toBeGreaterThan(0);
    const noMockMvcFile = result.files.find((f) =>
      f.path.endsWith("NoMockMvcTest.java"),
    );
    expect(noMockMvcFile).toBeDefined();
    expect(noMockMvcFile!.action).toBe("created");
    expect(existsSync(noMockMvcFile!.path)).toBe(true);
  });

  it("places NoMockMvcTest.java in src/test/java tree", () => {
    const config = makeConfig(dir, { language: "java", buildTool: "gradle" });
    const result = generateArchUnit(config);
    const noMockMvcFile = result.files.find((f) =>
      f.path.endsWith("NoMockMvcTest.java"),
    );
    expect(noMockMvcFile!.path).toContain("src/test/java");
  });

  it("NoMockMvcTest.java contains ArchUnit imports", () => {
    const config = makeConfig(dir, { language: "java", buildTool: "gradle" });
    const result = generateArchUnit(config);
    const testDir = existsSync(join(dir, "src", "test", "java"));
    expect(testDir).toBe(true);
    const noMockMvcFile = result.files.find((f) =>
      f.path.endsWith("NoMockMvcTest.java"),
    );
    const content = readFileSync(noMockMvcFile!.path, "utf-8");
    expect(content).toContain("com.tngtech.archunit");
    expect(content).toContain("MockMvc");
    expect(content).toContain("@AnalyzeClasses");
  });

  it("uses basePackage in @AnalyzeClasses when set", () => {
    const config = makeConfig(dir, {
      language: "java",
      buildTool: "gradle",
      basePackage: "com.example.myapp",
    });
    const result = generateArchUnit(config);
    const noMockMvcFile = result.files.find((f) =>
      f.path.endsWith("NoMockMvcTest.java"),
    );
    const content = readFileSync(noMockMvcFile!.path, "utf-8");
    expect(content).toContain("com.example.myapp");
  });

  it("returns empty files for non-Java projects", () => {
    for (const lang of ["typescript", "rust", "go", "python"] as const) {
      const nonJavaDir = createTestProject(lang);
      try {
        const config = makeConfig(nonJavaDir, { language: lang });
        const result = generateArchUnit(config);
        expect(result.files).toHaveLength(0);
      } finally {
        cleanupTestProject(nonJavaDir);
      }
    }
  });

  it("skips if file already exists", () => {
    const config = makeConfig(dir, { language: "java", buildTool: "gradle" });
    generateArchUnit(config);
    const second = generateArchUnit(config);
    const secondFile = second.files.find((f) =>
      f.path.endsWith("NoMockMvcTest.java"),
    );
    expect(secondFile?.action).toBe("skipped");
  });

  // ── architecture-style gate (ADR-021 / C2 fix) ───────────────────────────────

  it("does NOT generate ArchitectureTest.java when architectureStyle is 'none'", () => {
    const config = makeConfig(dir, {
      language: "java",
      buildTool: "gradle",
      architectureStyle: "none",
    });
    const result = generateArchUnit(config);
    const archTest = result.files.find((f) =>
      f.path.endsWith("ArchitectureTest.java"),
    );
    expect(archTest).toBeUndefined();
  });

  it("generates ArchitectureTest.java with hexagonal rules when architectureStyle is 'hexagonal'", () => {
    const config = makeConfig(dir, {
      language: "java",
      buildTool: "gradle",
      architectureStyle: "hexagonal",
    });
    const result = generateArchUnit(config);
    const archTest = result.files.find((f) =>
      f.path.endsWith("ArchitectureTest.java"),
    );
    expect(archTest).toBeDefined();
    const content = readFileSync(archTest!.path, "utf-8");
    expect(content).toContain("domain_must_not_depend_on_infrastructure");
    expect(content).toContain("adapters_must_not_depend_on_each_other");
  });

  it("generates ArchitectureTest.java with layered rules when architectureStyle is 'layered'", () => {
    const config = makeConfig(dir, {
      language: "java",
      buildTool: "gradle",
      architectureStyle: "layered",
    });
    const result = generateArchUnit(config);
    const archTest = result.files.find((f) =>
      f.path.endsWith("ArchitectureTest.java"),
    );
    expect(archTest).toBeDefined();
    const content = readFileSync(archTest!.path, "utf-8");
    expect(content).toContain("repositories_must_not_depend_on_services");
    expect(content).toContain("services_must_not_depend_on_controllers");
  });

  it("generates ArchitectureTest.java with modular-monolith rules when architectureStyle is 'modular-monolith'", () => {
    const config = makeConfig(dir, {
      language: "java",
      buildTool: "gradle",
      architectureStyle: "modular-monolith",
    });
    const result = generateArchUnit(config);
    const archTest = result.files.find((f) =>
      f.path.endsWith("ArchitectureTest.java"),
    );
    expect(archTest).toBeDefined();
    const content = readFileSync(archTest!.path, "utf-8");
    expect(content).toContain("no_cross_module_internal_access");
  });

  it("always generates NoMockMvcTest.java regardless of architectureStyle", () => {
    for (const style of [
      "none",
      "hexagonal",
      "layered",
      "modular-monolith",
    ] as const) {
      const styleDir = createTestProject("java");
      try {
        const config = makeConfig(styleDir, {
          language: "java",
          buildTool: "gradle",
          architectureStyle: style,
        });
        const result = generateArchUnit(config);
        const noMockMvc = result.files.find((f) =>
          f.path.endsWith("NoMockMvcTest.java"),
        );
        expect(noMockMvc).toBeDefined();
        expect(noMockMvc!.action).toBe("created");
      } finally {
        cleanupTestProject(styleDir);
      }
    }
  });
});

describe("generateArchUnit — hexagonal suite (M22)", () => {
  it("emits 7 arch test files + Gradle dep fragment for hexagonal+basePackage+gradle", () => {
    const config = makeConfig(dir, {
      language: "java",
      buildTool: "gradle",
      architectureStyle: "hexagonal",
      basePackage: "com.example.myapp",
    });
    const result = generateArchUnit(config);
    const paths = result.files.map((f) => f.path);
    expect(paths.some((p) => p.endsWith("DomainPurityTest.java"))).toBe(true);
    expect(paths.some((p) => p.endsWith("DependencyFlowTest.java"))).toBe(true);
    expect(paths.some((p) => p.endsWith("PortsIndependenceTest.java"))).toBe(
      true,
    );
    expect(paths.some((p) => p.endsWith("TestCoverageArchTest.java"))).toBe(
      true,
    );
    expect(paths.some((p) => p.endsWith("arch-test-deps.gradle"))).toBe(true);
  });

  it("places hexagonal test files in src/test/java/<packagePath>/architecture", () => {
    const config = makeConfig(dir, {
      language: "java",
      buildTool: "gradle",
      architectureStyle: "hexagonal",
      basePackage: "com.example.myapp",
    });
    const result = generateArchUnit(config);
    const domainPurity = result.files.find((f) =>
      f.path.endsWith("DomainPurityTest.java"),
    );
    expect(domainPurity!.path).toContain("src/test/java");
    expect(domainPurity!.path).toContain("com/example/myapp/architecture");
  });

  it("DomainPurityTest.java contains domain purity rules", () => {
    const config = makeConfig(dir, {
      language: "java",
      buildTool: "gradle",
      architectureStyle: "hexagonal",
      basePackage: "com.example.myapp",
    });
    const result = generateArchUnit(config);
    const file = result.files.find((f) =>
      f.path.endsWith("DomainPurityTest.java"),
    );
    const content = readFileSync(file!.path, "utf-8");
    expect(content).toContain("domain_must_not_import_spring");
    expect(content).toContain("domain_must_not_import_jpa");
    expect(content).toContain("com.example.myapp");
  });

  it("DependencyFlowTest.java contains dependency flow rules", () => {
    const config = makeConfig(dir, {
      language: "java",
      buildTool: "gradle",
      architectureStyle: "hexagonal",
      basePackage: "com.example.myapp",
    });
    const result = generateArchUnit(config);
    const file = result.files.find((f) =>
      f.path.endsWith("DependencyFlowTest.java"),
    );
    const content = readFileSync(file!.path, "utf-8");
    expect(content).toContain("adapters_must_not_depend_on_domain_directly");
    expect(content).toContain("application_must_not_depend_on_adapters");
    expect(content).toContain("domain_must_not_depend_on_application");
    expect(content).toContain("domain_must_not_depend_on_infrastructure");
  });

  it("PortsIndependenceTest.java contains ports independence rules", () => {
    const config = makeConfig(dir, {
      language: "java",
      buildTool: "gradle",
      architectureStyle: "hexagonal",
      basePackage: "com.example.myapp",
    });
    const result = generateArchUnit(config);
    const file = result.files.find((f) =>
      f.path.endsWith("PortsIndependenceTest.java"),
    );
    const content = readFileSync(file!.path, "utf-8");
    expect(content).toContain("inbound_ports_must_not_depend_on_adapters");
    expect(content).toContain("outbound_ports_must_not_depend_on_adapters");
  });

  it("TestCoverageArchTest.java contains test coverage rule", () => {
    const config = makeConfig(dir, {
      language: "java",
      buildTool: "gradle",
      architectureStyle: "hexagonal",
      basePackage: "com.example.myapp",
    });
    const result = generateArchUnit(config);
    const file = result.files.find((f) =>
      f.path.endsWith("TestCoverageArchTest.java"),
    );
    const content = readFileSync(file!.path, "utf-8");
    expect(content).toContain("every_controller_must_have_integration_test");
  });

  it("arch-test-deps.gradle contains ArchUnit + RestAssured + Testcontainers deps", () => {
    const config = makeConfig(dir, {
      language: "java",
      buildTool: "gradle",
      architectureStyle: "hexagonal",
      basePackage: "com.example.myapp",
    });
    const result = generateArchUnit(config);
    const file = result.files.find((f) =>
      f.path.endsWith("arch-test-deps.gradle"),
    );
    const content = readFileSync(file!.path, "utf-8");
    expect(content).toContain("archunit-junit5");
    expect(content).toContain("rest-assured");
    expect(content).toContain("postgresql");
    expect(content).toContain("apply from:");
  });

  it("emits Maven .md doc instead of .gradle when buildTool is maven", () => {
    const config = makeConfig(dir, {
      language: "java",
      buildTool: "maven",
      architectureStyle: "hexagonal",
      basePackage: "com.example.myapp",
    });
    const result = generateArchUnit(config);
    const paths = result.files.map((f) => f.path);
    expect(paths.some((p) => p.endsWith("arch-test-deps.gradle"))).toBe(false);
    expect(paths.some((p) => p.endsWith("arch-test-deps-maven.md"))).toBe(true);
    expect(paths.some((p) => p.endsWith("DomainPurityTest.java"))).toBe(true);
  });

  it("skips hexagonal suite when basePackage is absent", () => {
    const config = makeConfig(dir, {
      language: "java",
      buildTool: "gradle",
      architectureStyle: "hexagonal",
      basePackage: undefined,
    });
    const result = generateArchUnit(config);
    const paths = result.files.map((f) => f.path);
    expect(paths.some((p) => p.endsWith("DomainPurityTest.java"))).toBe(false);
    expect(paths.some((p) => p.endsWith("arch-test-deps.gradle"))).toBe(false);
    expect(paths.some((p) => p.endsWith("NoMockMvcTest.java"))).toBe(true);
  });

  it("emits RestAssuredBaseIT and RestAssuredArchTest when hasDatabase+hasPublicApi+hexagonal", () => {
    const config = makeConfig(dir, {
      language: "java",
      buildTool: "gradle",
      architectureStyle: "hexagonal",
      basePackage: "com.example.myapp",
      hasDatabase: true,
      hasPublicApi: true,
    });
    const result = generateArchUnit(config);
    const paths = result.files.map((f) => f.path);
    expect(paths.some((p) => p.endsWith("RestAssuredBaseIT.java"))).toBe(true);
    expect(paths.some((p) => p.endsWith("RestAssuredArchTest.java"))).toBe(
      true,
    );
  });

  it("RestAssuredBaseIT.java is placed in support/ package", () => {
    const config = makeConfig(dir, {
      language: "java",
      buildTool: "gradle",
      architectureStyle: "hexagonal",
      basePackage: "com.example.myapp",
      hasDatabase: true,
      hasPublicApi: true,
    });
    const result = generateArchUnit(config);
    const file = result.files.find((f) =>
      f.path.endsWith("RestAssuredBaseIT.java"),
    );
    expect(file!.path).toContain("support");
    expect(file!.path).toContain("com/example/myapp");
  });

  it("RestAssuredBaseIT.java contains Testcontainers + RestAssured setup", () => {
    const config = makeConfig(dir, {
      language: "java",
      buildTool: "gradle",
      architectureStyle: "hexagonal",
      basePackage: "com.example.myapp",
      hasDatabase: true,
      hasPublicApi: true,
    });
    const result = generateArchUnit(config);
    const file = result.files.find((f) =>
      f.path.endsWith("RestAssuredBaseIT.java"),
    );
    const content = readFileSync(file!.path, "utf-8");
    expect(content).toContain("PostgreSQLContainer");
    expect(content).toContain("RestAssured");
    expect(content).toContain("SpringBootTest");
    expect(content).toContain("authHeader");
  });

  it("RestAssuredArchTest.java contains controller IT enforcement rules", () => {
    const config = makeConfig(dir, {
      language: "java",
      buildTool: "gradle",
      architectureStyle: "hexagonal",
      basePackage: "com.example.myapp",
      hasDatabase: true,
      hasPublicApi: true,
    });
    const result = generateArchUnit(config);
    const file = result.files.find((f) =>
      f.path.endsWith("RestAssuredArchTest.java"),
    );
    const content = readFileSync(file!.path, "utf-8");
    expect(content).toContain(
      "all_controller_its_must_extend_rest_assured_base",
    );
    expect(content).toContain("RestAssuredBaseIT");
  });

  it("omits RestAssuredBaseIT and RestAssuredArchTest when hasDatabase is false", () => {
    const config = makeConfig(dir, {
      language: "java",
      buildTool: "gradle",
      architectureStyle: "hexagonal",
      basePackage: "com.example.myapp",
      hasDatabase: false,
      hasPublicApi: true,
    });
    const result = generateArchUnit(config);
    const paths = result.files.map((f) => f.path);
    expect(paths.some((p) => p.endsWith("RestAssuredBaseIT.java"))).toBe(false);
    expect(paths.some((p) => p.endsWith("RestAssuredArchTest.java"))).toBe(
      false,
    );
  });

  it("omits RestAssuredBaseIT and RestAssuredArchTest when hasPublicApi is false", () => {
    const config = makeConfig(dir, {
      language: "java",
      buildTool: "gradle",
      architectureStyle: "hexagonal",
      basePackage: "com.example.myapp",
      hasDatabase: true,
      hasPublicApi: false,
    });
    const result = generateArchUnit(config);
    const paths = result.files.map((f) => f.path);
    expect(paths.some((p) => p.endsWith("RestAssuredBaseIT.java"))).toBe(false);
    expect(paths.some((p) => p.endsWith("RestAssuredArchTest.java"))).toBe(
      false,
    );
  });

  it("does NOT emit hexagonal suite for layered architectureStyle", () => {
    const config = makeConfig(dir, {
      language: "java",
      buildTool: "gradle",
      architectureStyle: "layered",
      basePackage: "com.example.myapp",
    });
    const result = generateArchUnit(config);
    const paths = result.files.map((f) => f.path);
    expect(paths.some((p) => p.endsWith("DomainPurityTest.java"))).toBe(false);
    expect(paths.some((p) => p.endsWith("DependencyFlowTest.java"))).toBe(
      false,
    );
    expect(paths.some((p) => p.endsWith("arch-test-deps.gradle"))).toBe(false);
    expect(paths.some((p) => p.endsWith("ArchitectureTest.java"))).toBe(true);
  });

  it("does NOT emit hexagonal suite for modular-monolith architectureStyle", () => {
    const config = makeConfig(dir, {
      language: "java",
      buildTool: "gradle",
      architectureStyle: "modular-monolith",
      basePackage: "com.example.myapp",
    });
    const result = generateArchUnit(config);
    const paths = result.files.map((f) => f.path);
    expect(paths.some((p) => p.endsWith("DomainPurityTest.java"))).toBe(false);
    expect(paths.some((p) => p.endsWith("ArchitectureTest.java"))).toBe(true);
  });

  it("emits NamingConventionsTest.java, AntiCyclicTest.java, NoH2ArchTest.java for hexagonal+basePackage", () => {
    const config = makeConfig(dir, {
      language: "java",
      buildTool: "gradle",
      architectureStyle: "hexagonal",
      basePackage: "com.example.myapp",
    });
    const result = generateArchUnit(config);
    const paths = result.files.map((f) => f.path);
    expect(paths.some((p) => p.endsWith("NamingConventionsTest.java"))).toBe(
      true,
    );
    expect(paths.some((p) => p.endsWith("AntiCyclicTest.java"))).toBe(true);
    expect(paths.some((p) => p.endsWith("NoH2ArchTest.java"))).toBe(true);
  });

  it("NamingConventionsTest.java contains naming convention rules", () => {
    const config = makeConfig(dir, {
      language: "java",
      buildTool: "gradle",
      architectureStyle: "hexagonal",
      basePackage: "com.example.myapp",
    });
    const result = generateArchUnit(config);
    const file = result.files.find((f) =>
      f.path.endsWith("NamingConventionsTest.java"),
    );
    const content = readFileSync(file!.path, "utf-8");
    expect(content).toContain("services_should_end_with_service");
    expect(content).toContain("repositories_should_end_with_repository");
    expect(content).toContain("controllers_should_end_with_controller");
    expect(content).toContain("ports_should_end_with_port");
    expect(content).toContain("@ArchTest");
    expect(content).toContain("com.example.myapp");
  });

  it("AntiCyclicTest.java contains SlicesRuleDefinition cycle check", () => {
    const config = makeConfig(dir, {
      language: "java",
      buildTool: "gradle",
      architectureStyle: "hexagonal",
      basePackage: "com.example.myapp",
    });
    const result = generateArchUnit(config);
    const file = result.files.find((f) =>
      f.path.endsWith("AntiCyclicTest.java"),
    );
    const content = readFileSync(file!.path, "utf-8");
    expect(content).toContain("SlicesRuleDefinition");
    expect(content).toContain("beFreeOfCycles");
    expect(content).toContain("no_cycles_between_slices");
    expect(content).toContain("com.example.myapp");
  });

  it("NoH2ArchTest.java contains H2 import prohibition", () => {
    const config = makeConfig(dir, {
      language: "java",
      buildTool: "gradle",
      architectureStyle: "hexagonal",
      basePackage: "com.example.myapp",
    });
    const result = generateArchUnit(config);
    const file = result.files.find((f) => f.path.endsWith("NoH2ArchTest.java"));
    const content = readFileSync(file!.path, "utf-8");
    expect(content).toContain("no_h2_imports_in_production_code");
    expect(content).toContain("org.h2..");
    expect(content).toContain("@ArchTest");
    expect(content).toContain("com.example.myapp");
  });
});

describe("generateArchUnit — F11 unknown architectureStyle guard (#370)", () => {
  let dir: string;
  beforeEach(() => {
    dir = createTestProject("java");
  });
  afterEach(() => {
    cleanupTestProject(dir);
  });

  it("throws on unknown architectureStyle with helpful message (#370)", () => {
    const config = makeConfig(dir, {
      language: "java",
      buildTool: "gradle",
      architectureStyle: "foo" as never,
    });
    expect(() => generateArchUnit(config)).toThrow(
      /unknown architectureStyle/i,
    );
  });

  it("does not throw on known styles: hexagonal, layered, modular-monolith, none", () => {
    for (const style of [
      "hexagonal",
      "layered",
      "modular-monolith",
      "none",
    ] as const) {
      const config = makeConfig(dir, {
        language: "java",
        buildTool: "gradle",
        architectureStyle: style,
      });
      expect(() => generateArchUnit(config)).not.toThrow();
    }
  });
});
