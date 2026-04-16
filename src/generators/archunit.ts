import { renderTemplate } from "../utils/render.js";
import { writeFile, resolvedPath } from "../utils/fs.js";
import type { ProjectConfig } from "../wizard/types.js";
import type { WriteResult } from "../utils/fs.js";

export interface ArchUnitGeneratorResult {
  files: WriteResult[];
}

function emitHexagonalSuite(
  config: ProjectConfig & { basePackage: string },
  base: string,
  packagePath: string,
  data: Record<string, unknown>,
): WriteResult[] {
  const files: WriteResult[] = [];

  for (const name of [
    "DomainPurityTest.java",
    "DependencyFlowTest.java",
    "PortsIndependenceTest.java",
    "TestCoverageArchTest.java",
  ] as const) {
    files.push(
      writeFile(
        resolvedPath(base, "src", "test", "java", packagePath, name),
        renderTemplate(`archunit/${name}.ejs`, data),
        { skipIfExists: true },
      ),
    );
  }

  if (config.hasDatabase && config.hasPublicApi) {
    const supportPath = config.basePackage.replace(/\./g, "/") + "/support";

    files.push(
      writeFile(
        resolvedPath(
          base,
          "src",
          "test",
          "java",
          supportPath,
          "RestAssuredBaseIT.java",
        ),
        renderTemplate("archunit/RestAssuredBaseIT.java.ejs", data),
        { skipIfExists: true },
      ),
    );

    files.push(
      writeFile(
        resolvedPath(
          base,
          "src",
          "test",
          "java",
          packagePath,
          "RestAssuredArchTest.java",
        ),
        renderTemplate("archunit/RestAssuredArchTest.java.ejs", data),
        { skipIfExists: true },
      ),
    );
  }

  if (config.buildTool === "gradle") {
    files.push(
      writeFile(
        resolvedPath(base, "gradle", "arch-test-deps.gradle"),
        renderTemplate("archunit/arch-test-deps.gradle.ejs", data),
        { skipIfExists: true },
      ),
    );
  } else if (config.buildTool === "maven") {
    files.push(
      writeFile(
        resolvedPath(base, "docs", "arch-test-deps-maven.md"),
        renderTemplate("archunit/arch-test-deps-maven.md.ejs", data),
        { skipIfExists: true },
      ),
    );
  }

  return files;
}

export function generateArchUnit(
  config: ProjectConfig,
): ArchUnitGeneratorResult {
  if (config.language !== "java") return { files: [] };

  const base = config.targetDir;
  const data = config as unknown as Record<string, unknown>;

  const packagePath = config.basePackage
    ? config.basePackage.replace(/\./g, "/") + "/architecture"
    : "architecture";

  const files: WriteResult[] = [];

  // INV-29: NoMockMvc rule — always emitted for Java (test-quality rule, not architecture-style)
  files.push(
    writeFile(
      resolvedPath(
        base,
        "src",
        "test",
        "java",
        packagePath,
        "NoMockMvcTest.java",
      ),
      renderTemplate("archunit/NoMockMvcTest.java.ejs", data),
      { skipIfExists: true },
    ),
  );

  // Architecture style rules — only when user explicitly chose a style (ADR-021 gate rule)
  if (config.architectureStyle !== "none") {
    files.push(
      writeFile(
        resolvedPath(
          base,
          "src",
          "test",
          "java",
          packagePath,
          "ArchitectureTest.java",
        ),
        renderTemplate("archunit/ArchitectureTest.java.ejs", data),
        { skipIfExists: true },
      ),
    );
  }

  // M22: Hexagonal suite — requires hexagonal style AND basePackage.
  // basePackage is mandatory to avoid @AnalyzeClasses(packages="") scanning the entire JVM classpath.
  if (config.architectureStyle === "hexagonal" && config.basePackage) {
    files.push(
      ...emitHexagonalSuite(
        config as ProjectConfig & { basePackage: string },
        base,
        packagePath,
        data,
      ),
    );
  }

  return { files };
}
