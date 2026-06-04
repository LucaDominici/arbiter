// SPDX-License-Identifier: Apache-2.0
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
  data: ProjectConfig,
  dryRun: boolean,
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
        { skipIfExists: true, dryRun },
      ),
    )
  }

  if (config.buildTool === 'gradle') {
    files.push(
      writeFile(
        resolvedPath(base, 'gradle', 'arch-test-deps.gradle'),
        renderTemplate('archunit/arch-test-deps.gradle.ejs', data),
        { skipIfExists: true, dryRun },
      ),
    )
  } else if (config.buildTool === 'maven') {
    files.push(
      writeFile(
        resolvedPath(base, 'docs', 'arch-test-deps-maven.md'),
        renderTemplate('archunit/arch-test-deps-maven.md.ejs', data),
        { skipIfExists: true, dryRun },
      ),
    )
  }

  return files
}

function isSpring(framework: ProjectConfig['framework']): boolean {
  return (
    framework === 'spring-boot' || (typeof framework === 'string' && framework.includes('spring'))
  )
}

function emitRestAssuredScaffolding(
  config: ProjectConfig,
  base: string,
  packagePath: string,
  data: ProjectConfig,
  dryRun: boolean,
): WriteResult[] {
  if (
    !config.hasDatabase ||
    !config.hasPublicApi ||
    !config.basePackage ||
    !isSpring(config.framework)
  ) {
    return []
  }
  const supportPath = config.basePackage.replace(/\./g, '/') + '/support'
  return [
    writeFile(
      resolvedPath(base, 'src', 'test', 'java', supportPath, 'RestAssuredBaseIT.java'),
      renderTemplate('archunit/RestAssuredBaseIT.java.ejs', data),
      { skipIfExists: true, dryRun },
    ),
    writeFile(
      resolvedPath(base, 'src', 'test', 'java', packagePath, 'RestAssuredArchTest.java'),
      renderTemplate('archunit/RestAssuredArchTest.java.ejs', data),
      { skipIfExists: true, dryRun },
    ),
  ]
}

function emitHexagonalConsolidated(
  base: string,
  packagePath: string,
  data: ProjectConfig,
  dryRun: boolean,
): WriteResult {
  return writeFile(
    resolvedPath(base, 'src', 'test', 'java', packagePath, 'HexagonalArchTest.java'),
    renderTemplate('java/archunit-hexagonal.ejs', data),
    { skipIfExists: true, dryRun },
  )
}

const KNOWN_STYLES = new Set(['hexagonal', 'layered', 'modular-monolith', 'none'])

export function generateArchUnit(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): ArchUnitGeneratorResult {
  // #1177: Kotlin compiles to JVM bytecode; ArchUnit reads bytecode and works unchanged.
  // Java test files are emitted into src/test/java — Kotlin Gradle projects can mix source sets.
  // Operators must add `sourceSets { test { java { srcDirs += 'src/test/java' } } }` if needed.
  if (config.language !== 'java' && config.language !== 'kotlin') return { files: [] }

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
        { skipIfExists: true, dryRun: opts.dryRun },
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
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }

  // M22: Hexagonal suite — requires hexagonal style AND basePackage.
  // basePackage is mandatory to avoid @AnalyzeClasses(packages="") scanning the entire JVM classpath.
  // layered/modular-monolith suites are deferred; only ArchitectureTest.java is emitted for those styles.
  if (config.architectureStyle === 'hexagonal' && config.basePackage) {
    files.push(...emitHexagonalSuite(config, base, packagePath, data, opts.dryRun))
  }

  // #998: Consolidated hexagonal ArchUnit scaffold — emitted at L2+ when hexagonal style chosen.
  // Complements the individual-file suite with a single HexagonalArchTest class covering
  // domain / application / infrastructure layer boundaries (non-pharma generic projects).
  // basePackage required to avoid @AnalyzeClasses(packages="") scanning the entire JVM classpath (#285).
  if (
    config.architectureStyle === 'hexagonal' &&
    config.governanceLevel !== 'L1' &&
    config.basePackage
  ) {
    files.push(emitHexagonalConsolidated(base, packagePath, data, opts.dryRun))
  }

  // RestAssured scaffolding — see emitRestAssuredScaffolding for guard logic (#491).
  files.push(...emitRestAssuredScaffolding(config, base, packagePath, data, opts.dryRun))

  return { files }
}
