import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { generatePythonBoundaries } from '../../src/generators/python-boundaries.js'

let dir: string

beforeEach(() => {
  dir = createTestProject('python')
})

afterEach(() => {
  cleanupTestProject(dir)
})

describe('generatePythonBoundaries', () => {
  it('emits .importlinter, ruff-boundaries.toml, scripts/check-boundaries.mjs for python + hexagonal', () => {
    const config = makeConfig(dir, {
      language: 'python',
      architectureStyle: 'hexagonal',
    })
    const result = generatePythonBoundaries(config)
    expect(result.files).toHaveLength(3)
    expect(result.files[0].path).toContain('.importlinter')
    expect(result.files[0].action).toBe('created')
    expect(result.files[1].path).toContain('ruff-boundaries.toml')
    expect(result.files[1].action).toBe('created')
    expect(result.files[2].path).toContain('check-boundaries.mjs')
    expect(result.files[2].action).toBe('created')
    expect(existsSync(result.files[0].path)).toBe(true)
    expect(existsSync(result.files[1].path)).toBe(true)
    expect(existsSync(result.files[2].path)).toBe(true)
  })

  it('places .importlinter at project root', () => {
    const config = makeConfig(dir, {
      language: 'python',
      architectureStyle: 'hexagonal',
    })
    generatePythonBoundaries(config)
    expect(existsSync(join(dir, '.importlinter'))).toBe(true)
  })

  it('emitted .importlinter is non-empty', () => {
    const config = makeConfig(dir, {
      language: 'python',
      architectureStyle: 'hexagonal',
    })
    generatePythonBoundaries(config)
    const content = readFileSync(join(dir, '.importlinter'), 'utf-8')
    expect(content.length).toBeGreaterThan(0)
  })

  it('returns no files for python + layered (architecture guard)', () => {
    const config = makeConfig(dir, {
      language: 'python',
      architectureStyle: 'layered',
    })
    const result = generatePythonBoundaries(config)
    expect(result.files).toHaveLength(0)
  })

  it('returns no files for python + none (default architecture)', () => {
    const config = makeConfig(dir, { language: 'python' })
    const result = generatePythonBoundaries(config)
    expect(result.files).toHaveLength(0)
  })

  it('returns no files for go + hexagonal (language guard)', () => {
    const goDir = createTestProject('go')
    try {
      const config = makeConfig(goDir, {
        language: 'go',
        architectureStyle: 'hexagonal',
      })
      const result = generatePythonBoundaries(config)
      expect(result.files).toHaveLength(0)
    } finally {
      cleanupTestProject(goDir)
    }
  })

  it('returns no files for typescript + hexagonal (language guard)', () => {
    const tsDir = createTestProject('typescript')
    try {
      const config = makeConfig(tsDir, {
        language: 'typescript',
        architectureStyle: 'hexagonal',
      })
      const result = generatePythonBoundaries(config)
      expect(result.files).toHaveLength(0)
    } finally {
      cleanupTestProject(tsDir)
    }
  })

  it('honors skipIfExists when .importlinter already exists', () => {
    const config = makeConfig(dir, {
      language: 'python',
      architectureStyle: 'hexagonal',
    })
    const targetPath = join(dir, '.importlinter')
    writeFileSync(targetPath, '# existing')
    const result = generatePythonBoundaries(config)
    expect(result.files[0].action).toBe('skipped')
    expect(readFileSync(targetPath, 'utf-8')).toBe('# existing')
  })

  it('honors skipIfExists on second run for all three files', () => {
    const config = makeConfig(dir, {
      language: 'python',
      architectureStyle: 'hexagonal',
    })
    generatePythonBoundaries(config)
    const result = generatePythonBoundaries(config)
    expect(result.files[0].action).toBe('skipped')
    expect(result.files[1].action).toBe('skipped')
    expect(result.files[2].action).toBe('skipped')
  })
})
