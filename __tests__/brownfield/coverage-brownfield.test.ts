import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateCoverage } from '../../src/generators/coverage.js'

describe('brownfield: coverage generator (CANON-11)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('does not overwrite existing vitest.config.ts on re-run', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      enableDebtGates: true,
    })
    generateCoverage(config)

    const path = join(dir, 'vitest.config.ts')
    expect(existsSync(path)).toBe(true)
    writeFileSync(path, '// user-edited')

    generateCoverage(config)
    expect(readFileSync(path, 'utf-8')).toBe('// user-edited')
  })

  it('does not overwrite existing .tarpaulin.toml on re-run', () => {
    const rustDir = createTestProject('rust')
    initGit(rustDir)
    const config = makeConfig(rustDir, {
      language: 'rust',
      buildTool: 'cargo',
      enableDebtGates: true,
    })
    generateCoverage(config)

    const path = join(rustDir, '.tarpaulin.toml')
    expect(existsSync(path)).toBe(true)
    writeFileSync(path, '# user-edited')

    generateCoverage(config)
    expect(readFileSync(path, 'utf-8')).toBe('# user-edited')
    cleanupTestProject(rustDir)
  })

  it('does not overwrite existing .coveragerc on re-run', () => {
    const pyDir = createTestProject('python')
    initGit(pyDir)
    const config = makeConfig(pyDir, {
      language: 'python',
      buildTool: 'pip',
      enableDebtGates: true,
    })
    generateCoverage(config)

    const path = join(pyDir, '.coveragerc')
    expect(existsSync(path)).toBe(true)
    writeFileSync(path, '# user-edited')

    generateCoverage(config)
    expect(readFileSync(path, 'utf-8')).toBe('# user-edited')
    cleanupTestProject(pyDir)
  })

  it('does not overwrite existing gradle/jacoco.gradle on re-run', () => {
    const javaDir = createTestProject('java')
    initGit(javaDir)
    const config = makeConfig(javaDir, {
      language: 'java',
      buildTool: 'gradle',
      enableDebtGates: true,
    })
    generateCoverage(config)

    const path = join(javaDir, 'gradle', 'jacoco.gradle')
    expect(existsSync(path)).toBe(true)
    writeFileSync(path, '// user-edited')

    generateCoverage(config)
    expect(readFileSync(path, 'utf-8')).toBe('// user-edited')
    cleanupTestProject(javaDir)
  })

  it('does not overwrite existing docs/coverage/jacoco-maven-setup.md on re-run', () => {
    const javaDir = createTestProject('java')
    initGit(javaDir)
    const config = makeConfig(javaDir, {
      language: 'java',
      buildTool: 'maven',
      enableDebtGates: true,
    })
    generateCoverage(config)

    const path = join(javaDir, 'docs', 'coverage', 'jacoco-maven-setup.md')
    expect(existsSync(path)).toBe(true)
    writeFileSync(path, '# user-edited')

    generateCoverage(config)
    expect(readFileSync(path, 'utf-8')).toBe('# user-edited')
    cleanupTestProject(javaDir)
  })
})
