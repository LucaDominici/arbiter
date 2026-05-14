import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface ArchUnitGeneratorResult {
  files: WriteResult[]
}

function emitHexagonalSuite(
  config: ProjectConfig,
  base: string,
  packagePath: string,
  data: object,
): WriteResult[] {
  const files: WriteResult[] = []

  for (const name of [
    'DomainPurityTest.java',
    'DependencyFlowTest.java',
    'PortsIndependenceTest.java',
    'TestCoverageArchTest.java',
    'NamingConventionsTest.java',
    'AntiCyclicTest.java',
    'NoH2ArchTest.java',
  ] as const) {
    files.push(
      writeFile(
        resolvedPath(base, 'src', 'test', 'java', packagePath, name),
        renderTemplate(`archunit/${name}.ejs`, data),
        { skipIfExists: true },
      ),
    )
  }

  if (config.buildTool === 'gradle') {
    files.push(
      writeFile(
        resolvedPath(base, 'gradle', 'arch-test-deps.gradle'),
        renderTemplate('archunit/arch-test-deps.gradle.ejs', data),
        { skipIfExists: true },
      ),
    )
  } else if (config.buildTool === 'maven') {
    files.push(
      writeFile(
        resolvedPath(base, 'docs', 'arch-test-deps-maven.md'),
        renderTemplate('archunit/arch-test-deps-maven.md.ejs', data),
        { skipIfExists: true },
      ),
    )
  }

  return files
}

const KNOWN_STYLES = new Set(['hexagonal', 'layered', 'modular-monolith', 'none'])

export function generateArchUnit(config: ProjectConfig): ArchUnitGeneratorResult {
  if (config.language !== 'java') return { files: [] }

  if (!KNOWN_STYLES.has(config.architectureStyle)) {
    throw new Error(
      `archunit: unknown architectureStyle '${config.architectureStyle}'. Choose: hexagonal, layered, modular-monolith, or none.`,
    )
  }

  const base = config.targetDir
  const data = config

  const packagePath = config.basePackage
    ? config.basePackage.replace(/\./g, '/') + '/architecture'
    : 'architecture'

  const files: WriteResult[] = []

  // INV-29: NoMockMvc rule — emitted for Java when basePackage is set.
  // basePackage required to avoid @AnalyzeClasses(packages="") scanning the entire JVM classpath (#283).
  if (config.basePackage) {
    files.push(
      writeFile(
        resolvedPath(base, 'src', 'test', 'java', packagePath, 'NoMockMvcTest.java'),
        renderTemplate('archunit/NoMockMvcTest.java.ejs', data),
        { skipIfExists: true },
      ),
    )
  }

  // Architecture style rules — only when user explicitly chose a style (ADR-021 gate rule) AND basePackage set.
  // basePackage required to avoid @AnalyzeClasses(packages="") scanning the entire JVM classpath (#284).
  if (config.architectureStyle !== 'none' && config.basePackage) {
    files.push(
      writeFile(
        resolvedPath(base, 'src', 'test', 'java', packagePath, 'ArchitectureTest.java'),
        renderTemplate('archunit/ArchitectureTest.java.ejs', data),
        { skipIfExists: true },
      ),
    )
  }

  // M22: Hexagonal suite — requires hexagonal style AND basePackage.
  // basePackage is mandatory to avoid @AnalyzeClasses(packages="") scanning the entire JVM classpath.
  // layered/modular-monolith suites are deferred; only ArchitectureTest.java is emitted for those styles.
  if (config.architectureStyle === 'hexagonal' && config.basePackage) {
    files.push(...emitHexagonalSuite(config, base, packagePath, data))
  }

  // RestAssured scaffolding — emitted for ALL archetypes when hasDatabase + hasPublicApi + basePackage
  // AND the project uses a Spring-family framework (#491). The RestAssuredBaseIT template hardcodes
  // @SpringBootTest / @LocalServerPort / org.springframework.*; emitting it for Quarkus / Micronaut /
  // unknown-framework Java projects produces uncompilable scaffolding. Null framework treated as
  // "unknown" — safe default is no-emit.
  // basePackage required to avoid scanning the entire JVM classpath (same as hexagonal suite guard).
  const isSpringFramework =
    config.framework === 'spring-boot' ||
    (typeof config.framework === 'string' && config.framework.includes('spring'))
  if (config.hasDatabase && config.hasPublicApi && config.basePackage && isSpringFramework) {
    const supportPath = config.basePackage.replace(/\./g, '/') + '/support'

    files.push(
      writeFile(
        resolvedPath(base, 'src', 'test', 'java', supportPath, 'RestAssuredBaseIT.java'),
        renderTemplate('archunit/RestAssuredBaseIT.java.ejs', data),
        { skipIfExists: true },
      ),
    )

    files.push(
      writeFile(
        resolvedPath(base, 'src', 'test', 'java', packagePath, 'RestAssuredArchTest.java'),
        renderTemplate('archunit/RestAssuredArchTest.java.ejs', data),
        { skipIfExists: true },
      ),
    )
  }

  return { files }
}
