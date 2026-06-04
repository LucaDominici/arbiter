// SPDX-License-Identifier: Apache-2.0
// #1177: Kotlin real-stack support — detekt + kover + ArchUnit + sonar content tests.
// Tests assert actual generated file contents (not just file count).
// All new describe blocks must be RED before implementation (content does not exist yet).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { generateQuality } from '../../src/generators/quality.js'
import { generateModulith } from '../../src/generators/modulith.js'
import { generateDebtGates } from '../../src/generators/debt-gates.js'
import { generateCoverage } from '../../src/generators/coverage.js'
import { generateArchUnit } from '../../src/generators/archunit.js'
import type { ProjectConfig } from '../../src/wizard/types.js'

function makeConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    language: 'kotlin',
    buildTool: 'gradle',
    targetDir: '',
    projectName: 'kotlin-service',
    governanceLevel: 'L2',
    archetype: 'backend-web-db',
    architectureStyle: 'hexagonal',
    useGitHub: true,
    basePackage: 'com.example',
    kitEnabled: true,
    enableDebtGates: true,
    ...overrides,
  } as ProjectConfig
}

let tmpDir: string
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'arbiter-kotlin-'))
})
afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

// Preserved from #1150 — matrix cells must stay beta (not promoted to proven)
describe('Kotlin beta — cross-language matrix (#1150)', () => {
  it('declares kotlin beta cells for the core enforcement areas', () => {
    const matrix = JSON.parse(
      readFileSync('src/compatibility/cross-language-matrix.json', 'utf-8'),
    ) as Record<string, Record<string, { maturity: string }>>
    for (const cat of ['static_analysis', 'coverage', 'architecture', 'mutation']) {
      expect(matrix[cat].kotlin).toBeDefined()
      expect(matrix[cat].kotlin.maturity).toBe('beta')
    }
  })
})

// Preserved from #1150 — modulith still works
describe('Kotlin beta — modulith generator (#1150)', () => {
  it('emits modulith scaffolding for a kotlin Spring project', () => {
    const result = generateModulith(makeConfig({ targetDir: tmpDir }))
    expect(result.files.length).toBeGreaterThan(0)
  })
})

// #1177 — sonar must emit kotlin-specific paths (was: empty template, no kotlin branch)
describe('Kotlin real-stack — sonar config (#1177)', () => {
  it('emits sonar-project.properties with kotlin source paths', () => {
    const result = generateQuality(makeConfig({ targetDir: tmpDir }))
    expect(result.files.length, 'sonar file must be emitted for kotlin L2').toBeGreaterThan(0)
    const sonarPath = join(tmpDir, 'sonar-project.properties')
    expect(existsSync(sonarPath), 'sonar-project.properties must exist on disk').toBe(true)
    const content = readFileSync(sonarPath, 'utf-8')
    expect(content, 'must declare kotlin source dir').toContain('src/main/kotlin')
    expect(content, 'must declare kover XML report path for SonarQube').toContain(
      'build/reports/kover/report.xml',
    )
  })
})

// #1177 — detekt must be emitted (was: no kotlin branch in debt-gates)
describe('Kotlin real-stack — detekt static analysis (#1177)', () => {
  it('emits detekt.yml with kotlin-appropriate rules', () => {
    const result = generateDebtGates(makeConfig({ targetDir: tmpDir }))
    expect(
      result.files.length,
      'detekt.yml must be among emitted files for kotlin',
    ).toBeGreaterThan(0)
    const detektPath = join(tmpDir, 'config', 'detekt', 'detekt.yml')
    expect(existsSync(detektPath), 'config/detekt/detekt.yml must exist on disk').toBe(true)
    const content = readFileSync(detektPath, 'utf-8')
    expect(content, 'detekt config must set maxIssues').toContain('maxIssues: 0')
    expect(content, 'detekt config must include complexity rules').toContain('ComplexMethod')
  })
})

// #1177 — kover must be emitted (was: no kotlin branch in coverage)
describe('Kotlin real-stack — kover coverage (#1177)', () => {
  it('emits kover.gradle using kover 0.9.x API', () => {
    const result = generateCoverage(makeConfig({ targetDir: tmpDir }))
    expect(
      result.files.length,
      'kover.gradle must be among emitted files for kotlin',
    ).toBeGreaterThan(0)
    const koverPath = join(tmpDir, 'kover.gradle')
    expect(existsSync(koverPath), 'kover.gradle must exist on disk').toBe(true)
    const content = readFileSync(koverPath, 'utf-8')
    // Check actual DSL structure, not just comment strings
    expect(content, 'must use kover 0.9.x DSL block').toContain('kover {')
    expect(content, 'must configure reports.total.xml block').toContain('xml {')
    expect(content, 'must set coverage threshold via minValue').toContain('minValue = ')
  })
})

// #1177 — ArchUnit must be emitted for kotlin (was: language !== 'java' early return)
describe('Kotlin real-stack — ArchUnit architecture tests (#1177)', () => {
  it('emits ArchUnit test files for kotlin hexagonal project with real content', () => {
    const result = generateArchUnit(makeConfig({ targetDir: tmpDir }))
    expect(
      result.files.length,
      'ArchUnit test files must be emitted for kotlin hexagonal project',
    ).toBeGreaterThan(0)
    const archFile = result.files.find(
      (f) => f.path.includes('ArchitectureTest') || f.path.includes('HexagonalArchTest'),
    )
    expect(archFile, 'must emit an architecture test file').toBeDefined()
    const content = readFileSync(archFile!.path, 'utf-8')
    expect(content, 'must contain ArchUnit @AnalyzeClasses annotation').toContain('@AnalyzeClasses')
    expect(content, 'must reference base package').toContain('com.example')
  })
})
