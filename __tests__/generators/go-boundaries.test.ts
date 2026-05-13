import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateGoBoundaries } from '../../src/generators/go-boundaries.js'

let dir: string

beforeEach(() => {
  dir = createTestProject('go')
})

afterEach(() => {
  cleanupTestProject(dir)
})

describe('generateGoBoundaries', () => {
  it('emits .golangci-boundaries.yml and scripts/check-boundaries.mjs for go + hexagonal', () => {
    const config = makeConfig(dir, {
      language: 'go',
      architectureStyle: 'hexagonal',
    })
    const result = generateGoBoundaries(config)
    expect(result.files).toHaveLength(2)
    expect(result.files[0].path).toContain('.golangci-boundaries.yml')
    expect(result.files[0].action).toBe('created')
    expect(result.files[1].path).toContain('check-boundaries.mjs')
    expect(result.files[1].action).toBe('created')
    expect(existsSync(result.files[0].path)).toBe(true)
    expect(existsSync(result.files[1].path)).toBe(true)
  })

  it('places .golangci-boundaries.yml at project root', () => {
    const config = makeConfig(dir, {
      language: 'go',
      architectureStyle: 'hexagonal',
    })
    generateGoBoundaries(config)
    expect(existsSync(join(dir, '.golangci-boundaries.yml'))).toBe(true)
  })

  it('emitted golangci config is non-empty', () => {
    const config = makeConfig(dir, {
      language: 'go',
      architectureStyle: 'hexagonal',
    })
    generateGoBoundaries(config)
    const content = readFileSync(join(dir, '.golangci-boundaries.yml'), 'utf-8')
    expect(content.length).toBeGreaterThan(0)
  })

  it('returns no files for go + layered (architecture guard)', () => {
    const config = makeConfig(dir, {
      language: 'go',
      architectureStyle: 'layered',
    })
    const result = generateGoBoundaries(config)
    expect(result.files).toHaveLength(0)
  })

  it('returns no files for go + none (default architecture)', () => {
    const config = makeConfig(dir, { language: 'go' })
    const result = generateGoBoundaries(config)
    expect(result.files).toHaveLength(0)
  })

  it('returns no files for typescript + hexagonal (language guard)', () => {
    const tsDir = createTestProject('typescript')
    try {
      const config = makeConfig(tsDir, {
        language: 'typescript',
        architectureStyle: 'hexagonal',
      })
      const result = generateGoBoundaries(config)
      expect(result.files).toHaveLength(0)
    } finally {
      cleanupTestProject(tsDir)
    }
  })

  it('returns no files for python + hexagonal (language guard)', () => {
    const pyDir = createTestProject('python')
    try {
      const config = makeConfig(pyDir, {
        language: 'python',
        architectureStyle: 'hexagonal',
      })
      const result = generateGoBoundaries(config)
      expect(result.files).toHaveLength(0)
    } finally {
      cleanupTestProject(pyDir)
    }
  })

  it('honors skipIfExists when .golangci-boundaries.yml already exists', () => {
    const config = makeConfig(dir, {
      language: 'go',
      architectureStyle: 'hexagonal',
    })
    const targetPath = join(dir, '.golangci-boundaries.yml')
    writeFileSync(targetPath, '# existing content')
    const result = generateGoBoundaries(config)
    expect(result.files[0].action).toBe('skipped')
    expect(readFileSync(targetPath, 'utf-8')).toBe('# existing content')
  })

  it('honors skipIfExists when check-boundaries.mjs already exists on second run', () => {
    const config = makeConfig(dir, {
      language: 'go',
      architectureStyle: 'hexagonal',
    })
    generateGoBoundaries(config)
    const scriptPath = join(dir, 'scripts', 'check-boundaries.mjs')
    const firstContent = readFileSync(scriptPath, 'utf-8')
    const result = generateGoBoundaries(config)
    expect(result.files[1].action).toBe('skipped')
    expect(readFileSync(scriptPath, 'utf-8')).toBe(firstContent)
  })
})
