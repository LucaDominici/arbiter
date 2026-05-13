import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateDebtGates } from '../../src/generators/debt-gates.js'

describe('brownfield: debt-gates generator (CANON-11)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  // ── TypeScript ──────────────────────────────────────────────────────────────

  it('does not overwrite existing .eslintrc-static.json on re-run', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      enableDebtGates: true,
    })
    generateDebtGates(config)

    const path = join(dir, '.eslintrc-static.json')
    expect(existsSync(path)).toBe(true)
    writeFileSync(path, '{"user":"edited"}')

    generateDebtGates(config)
    expect(readFileSync(path, 'utf-8')).toBe('{"user":"edited"}')
  })

  it('does not overwrite existing .prettierrc.json on re-run', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      enableDebtGates: true,
    })
    generateDebtGates(config)

    const path = join(dir, '.prettierrc.json')
    expect(existsSync(path)).toBe(true)
    writeFileSync(path, '{"printWidth":80}')

    generateDebtGates(config)
    expect(readFileSync(path, 'utf-8')).toBe('{"printWidth":80}')
  })

  // ── Python ─────────────────────────────────────────────────────────────────

  it('does not overwrite existing ruff.toml on re-run', () => {
    const pythonDir = createTestProject('python')
    initGit(pythonDir)
    try {
      const config = makeConfig(pythonDir, {
        language: 'python',
        buildTool: 'pip',
        enableDebtGates: true,
      })
      generateDebtGates(config)

      const path = join(pythonDir, 'ruff.toml')
      expect(existsSync(path)).toBe(true)
      writeFileSync(path, '# user-edited ruff config')

      generateDebtGates(config)
      expect(readFileSync(path, 'utf-8')).toBe('# user-edited ruff config')
    } finally {
      cleanupTestProject(pythonDir)
    }
  })

  // ── Java ───────────────────────────────────────────────────────────────────

  it('does not overwrite existing config/checkstyle.xml on re-run', () => {
    const javaDir = createTestProject('java')
    initGit(javaDir)
    try {
      const config = makeConfig(javaDir, {
        language: 'java',
        buildTool: 'gradle',
        enableDebtGates: true,
      })
      generateDebtGates(config)

      const path = join(javaDir, 'config', 'checkstyle.xml')
      expect(existsSync(path)).toBe(true)
      writeFileSync(path, '<!-- user-edited checkstyle -->')

      generateDebtGates(config)
      expect(readFileSync(path, 'utf-8')).toBe('<!-- user-edited checkstyle -->')
    } finally {
      cleanupTestProject(javaDir)
    }
  })

  it('does not overwrite existing config/spotbugs-exclude.xml on re-run', () => {
    const javaDir = createTestProject('java')
    initGit(javaDir)
    try {
      const config = makeConfig(javaDir, {
        language: 'java',
        buildTool: 'gradle',
        enableDebtGates: true,
      })
      generateDebtGates(config)

      const path = join(javaDir, 'config', 'spotbugs-exclude.xml')
      expect(existsSync(path)).toBe(true)
      writeFileSync(path, '<!-- user-edited spotbugs -->')

      generateDebtGates(config)
      expect(readFileSync(path, 'utf-8')).toBe('<!-- user-edited spotbugs -->')
    } finally {
      cleanupTestProject(javaDir)
    }
  })

  it('does not overwrite existing spotless.gradle on re-run', () => {
    const javaDir = createTestProject('java')
    initGit(javaDir)
    try {
      const config = makeConfig(javaDir, {
        language: 'java',
        buildTool: 'gradle',
        enableDebtGates: true,
      })
      generateDebtGates(config)

      const path = join(javaDir, 'spotless.gradle')
      expect(existsSync(path)).toBe(true)
      writeFileSync(path, '// user-edited spotless')

      generateDebtGates(config)
      expect(readFileSync(path, 'utf-8')).toBe('// user-edited spotless')
    } finally {
      cleanupTestProject(javaDir)
    }
  })

  it('does not overwrite existing spotbugs.gradle on re-run (CANON-11)', () => {
    const javaDir = createTestProject('java')
    initGit(javaDir)
    try {
      const config = makeConfig(javaDir, {
        language: 'java',
        buildTool: 'gradle',
        enableDebtGates: true,
      })
      generateDebtGates(config)

      const path = join(javaDir, 'spotbugs.gradle')
      expect(existsSync(path)).toBe(true)
      writeFileSync(path, '// user-edited spotbugs')

      generateDebtGates(config)
      expect(readFileSync(path, 'utf-8')).toBe('// user-edited spotbugs')
    } finally {
      cleanupTestProject(javaDir)
    }
  })
})
