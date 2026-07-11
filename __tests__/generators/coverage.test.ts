import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateCoverage } from '../../src/generators/coverage.js'

describe('generateCoverage', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('returns empty files array when enableDebtGates is false', () => {
    const config = makeConfig(dir, { enableDebtGates: false })
    const result = generateCoverage(config)
    expect(result.files).toHaveLength(0)
  })

  // ── TypeScript ──────────────────────────────────────────────────────────────

  it('generates vitest.config.ts for TypeScript projects', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      enableDebtGates: true,
    })
    const result = generateCoverage(config)
    expect(result.files.some((f) => f.path.endsWith('vitest.config.ts'))).toBe(true)
    expect(existsSync(join(dir, 'vitest.config.ts'))).toBe(true)
  })

  it('vitest.config.ts contains coverage provider and reporters', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      enableDebtGates: true,
    })
    generateCoverage(config)
    const content = readFileSync(join(dir, 'vitest.config.ts'), 'utf-8')
    expect(content).toContain('v8')
    expect(content).toContain('html')
    expect(content).toContain('lcov')
  })

  it("vitest.config.ts contains include: ['src/**'] to scope coverage to source files", () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      enableDebtGates: true,
    })
    generateCoverage(config)
    const content = readFileSync(join(dir, 'vitest.config.ts'), 'utf-8')
    expect(content).toContain("include: ['src/**']")
  })

  it('#1527: vitest lines/functions/statements share ONE floor (no mixed SSOT)', () => {
    // At L1 the old template emitted lines:60 but functions/statements:80 inside
    // the same file (SSOT-A vs SSOT-B). They must now all be the same number.
    const config = makeConfig(dir, {
      language: 'typescript',
      governanceLevel: 'L1',
      enableDebtGates: true,
      thresholdProfile: 'fixed',
    })
    generateCoverage(config)
    const content = readFileSync(join(dir, 'vitest.config.ts'), 'utf-8')
    const grab = (key: string): number => {
      const m = content.match(new RegExp(`${key}:\\s*(\\d+)`))
      if (!m) throw new Error(`missing ${key} in vitest.config.ts`)
      return Number(m[1])
    }
    const lines = grab('lines')
    expect(lines).toBe(60) // DEFAULT_THRESHOLDS.L1.lineCoverage — the single SSOT
    expect(grab('functions')).toBe(lines)
    expect(grab('statements')).toBe(lines)
    expect(grab('branches')).toBe(50) // DEFAULT_THRESHOLDS.L1.branchCoverage
  })

  it('#1527: an explicit lineCoverage override propagates to all coverage keys', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      governanceLevel: 'L2',
      enableDebtGates: true,
      thresholdProfile: 'fixed',
      thresholds: {
        lineCoverage: 90,
        branchCoverage: 70,
        mutationScore: 80,
        cyclomaticComplexity: 15,
        methodLength: 65,
        maxParams: 7,
      },
    })
    generateCoverage(config)
    const content = readFileSync(join(dir, 'vitest.config.ts'), 'utf-8')
    expect(content).toContain('lines: 90')
    expect(content).toContain('functions: 90')
    expect(content).toContain('statements: 90')
    expect(content).toContain('branches: 70')
  })

  // ── Java ───────────────────────────────────────────────────────────────────

  it('generates gradle/jacoco.gradle for Java Gradle projects', () => {
    const javaDir = createTestProject('java')
    initGit(javaDir)
    const config = makeConfig(javaDir, {
      language: 'java',
      buildTool: 'gradle',
      enableDebtGates: true,
    })
    const result = generateCoverage(config)
    expect(result.files.some((f) => f.path.endsWith('jacoco.gradle'))).toBe(true)
    expect(existsSync(join(javaDir, 'gradle', 'jacoco.gradle'))).toBe(true)
    cleanupTestProject(javaDir)
  })

  it('generates docs/coverage/jacoco-maven-setup.md for Java Maven projects', () => {
    const javaDir = createTestProject('java')
    initGit(javaDir)
    const config = makeConfig(javaDir, {
      language: 'java',
      buildTool: 'maven',
      enableDebtGates: true,
    })
    const result = generateCoverage(config)
    expect(result.files.some((f) => f.path.endsWith('jacoco-maven-setup.md'))).toBe(true)
    expect(existsSync(join(javaDir, 'docs', 'coverage', 'jacoco-maven-setup.md'))).toBe(true)
    cleanupTestProject(javaDir)
  })

  // #1887-F: gradle/jacoco.gradle was emitted but never wired into the root
  // build — the same class of ghost as #1886 (modulith-deps.gradle). Mirrors
  // modulith.test.ts's "dependency wiring (#1886)" describe block.
  describe('gradle/jacoco.gradle wiring (#1887-F)', () => {
    it('wires gradle/jacoco.gradle into the root build via apply(from=...)', () => {
      const javaDir = createTestProject('java')
      initGit(javaDir)
      const config = makeConfig(javaDir, {
        language: 'java',
        buildTool: 'gradle',
        enableDebtGates: true,
      })
      generateCoverage(config)
      const build = readFileSync(join(javaDir, 'build.gradle'), 'utf-8')
      expect(build).toContain("apply from: 'gradle/jacoco.gradle'")
      cleanupTestProject(javaDir)
    })

    it('withholds the apply-from when the root build already configures jacoco {} inline', () => {
      const javaDir = createTestProject('java')
      initGit(javaDir)
      writeFileSync(
        join(javaDir, 'build.gradle'),
        'plugins { id "java" }\n\njacoco {\n    toolVersion = \'0.8.7\'\n}\n',
      )
      const config = makeConfig(javaDir, {
        language: 'java',
        buildTool: 'gradle',
        enableDebtGates: true,
      })
      generateCoverage(config)
      const build = readFileSync(join(javaDir, 'build.gradle'), 'utf-8')
      expect(build).not.toContain("apply from: 'gradle/jacoco.gradle'")
      cleanupTestProject(javaDir)
    })

    it('does not crash when no Gradle build script exists yet', () => {
      const javaDir = createTestProject('typescript')
      initGit(javaDir)
      const config = makeConfig(javaDir, {
        language: 'java',
        buildTool: 'gradle',
        enableDebtGates: true,
      })
      expect(() => generateCoverage(config)).not.toThrow()
      cleanupTestProject(javaDir)
    })
  })

  // ── Kotlin ─────────────────────────────────────────────────────────────────

  describe('kover.gradle wiring (#1887-F)', () => {
    it('declares the kover plugin in the root plugins block and wires kover.gradle', () => {
      const kotlinDir = createTestProject('java')
      initGit(kotlinDir)
      const config = makeConfig(kotlinDir, {
        language: 'kotlin',
        buildTool: 'gradle',
        enableDebtGates: true,
      })
      generateCoverage(config)
      const build = readFileSync(join(kotlinDir, 'build.gradle'), 'utf-8')
      expect(build).toMatch(/id 'org\.jetbrains\.kotlinx\.kover' version '\d/)
      expect(build).toContain("apply from: 'kover.gradle'")
      cleanupTestProject(kotlinDir)
    })

    it('withholds the apply-from when the root build already configures kover {} inline', () => {
      const kotlinDir = createTestProject('java')
      initGit(kotlinDir)
      writeFileSync(
        join(kotlinDir, 'build.gradle'),
        'plugins { id "java" }\n\nkover {\n    reports {}\n}\n',
      )
      const config = makeConfig(kotlinDir, {
        language: 'kotlin',
        buildTool: 'gradle',
        enableDebtGates: true,
      })
      generateCoverage(config)
      const build = readFileSync(join(kotlinDir, 'build.gradle'), 'utf-8')
      expect(build).not.toContain("apply from: 'kover.gradle'")
      cleanupTestProject(kotlinDir)
    })

    it('does not crash when no Gradle build script exists yet', () => {
      const kotlinDir = createTestProject('typescript')
      initGit(kotlinDir)
      const config = makeConfig(kotlinDir, {
        language: 'kotlin',
        buildTool: 'gradle',
        enableDebtGates: true,
      })
      expect(() => generateCoverage(config)).not.toThrow()
      cleanupTestProject(kotlinDir)
    })
  })

  // ── Rust ───────────────────────────────────────────────────────────────────

  it('generates .tarpaulin.toml for Rust projects', () => {
    const rustDir = createTestProject('rust')
    initGit(rustDir)
    const config = makeConfig(rustDir, {
      language: 'rust',
      buildTool: 'cargo',
      enableDebtGates: true,
    })
    const result = generateCoverage(config)
    expect(result.files.some((f) => f.path.endsWith('.tarpaulin.toml'))).toBe(true)
    expect(existsSync(join(rustDir, '.tarpaulin.toml'))).toBe(true)
    cleanupTestProject(rustDir)
  })

  // ── Python ─────────────────────────────────────────────────────────────────

  it('generates .coveragerc for Python projects', () => {
    const pyDir = createTestProject('python')
    initGit(pyDir)
    const config = makeConfig(pyDir, {
      language: 'python',
      buildTool: 'pip',
      enableDebtGates: true,
    })
    const result = generateCoverage(config)
    expect(result.files.some((f) => f.path.endsWith('.coveragerc'))).toBe(true)
    expect(existsSync(join(pyDir, '.coveragerc'))).toBe(true)
    cleanupTestProject(pyDir)
  })

  // ── Go ─────────────────────────────────────────────────────────────────────

  it('returns no config file for Go projects (gate script handles inline)', () => {
    const goDir = createTestProject('go')
    initGit(goDir)
    const config = makeConfig(goDir, {
      language: 'go',
      buildTool: 'go',
      enableDebtGates: true,
    })
    const result = generateCoverage(config)
    expect(result.files).toHaveLength(0)
    cleanupTestProject(goDir)
  })

  // ── Multi (Java+TS monorepo) ────────────────────────────────────────────────

  it('generates both vitest.config.ts and jacoco.gradle for multi projects', () => {
    const multiDir = createTestProject('multi')
    initGit(multiDir)
    const config = makeConfig(multiDir, {
      language: 'multi',
      buildTool: 'gradle',
      enableDebtGates: true,
    })
    const result = generateCoverage(config)
    expect(result.files.some((f) => f.path.endsWith('vitest.config.ts'))).toBe(true)
    expect(result.files.some((f) => f.path.endsWith('jacoco.gradle'))).toBe(true)
    expect(existsSync(join(multiDir, 'vitest.config.ts'))).toBe(true)
    expect(existsSync(join(multiDir, 'gradle', 'jacoco.gradle'))).toBe(true)
    cleanupTestProject(multiDir)
  })
})
