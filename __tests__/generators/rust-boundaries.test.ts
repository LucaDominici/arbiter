import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateRustBoundaries } from '../../src/generators/rust-boundaries.js'

let dir: string

beforeEach(() => {
  dir = createTestProject('rust')
})

afterEach(() => {
  cleanupTestProject(dir)
})

describe('generateRustBoundaries', () => {
  it('emits deny.toml, clippy.toml, scripts/check-boundaries.mjs for rust + hexagonal', () => {
    const config = makeConfig(dir, {
      language: 'rust',
      architectureStyle: 'hexagonal',
    })
    const result = generateRustBoundaries(config)
    expect(result.files).toHaveLength(3)
    expect(result.files[0].path).toContain('deny.toml')
    expect(result.files[0].action).toBe('created')
    expect(result.files[1].path).toContain('clippy.toml')
    expect(result.files[1].action).toBe('created')
    expect(result.files[2].path).toContain('check-boundaries.mjs')
    expect(result.files[2].action).toBe('created')
    expect(existsSync(result.files[0].path)).toBe(true)
    expect(existsSync(result.files[1].path)).toBe(true)
    expect(existsSync(result.files[2].path)).toBe(true)
  })

  it('places deny.toml at project root', () => {
    const config = makeConfig(dir, {
      language: 'rust',
      architectureStyle: 'hexagonal',
    })
    generateRustBoundaries(config)
    expect(existsSync(join(dir, 'deny.toml'))).toBe(true)
  })

  it('emitted deny.toml is non-empty', () => {
    const config = makeConfig(dir, {
      language: 'rust',
      architectureStyle: 'hexagonal',
    })
    generateRustBoundaries(config)
    const content = readFileSync(join(dir, 'deny.toml'), 'utf-8')
    expect(content.length).toBeGreaterThan(0)
  })

  it('returns no files for rust + layered (architecture guard)', () => {
    const config = makeConfig(dir, {
      language: 'rust',
      architectureStyle: 'layered',
    })
    const result = generateRustBoundaries(config)
    expect(result.files).toHaveLength(0)
  })

  it('returns no files for rust + none (default architecture)', () => {
    const config = makeConfig(dir, { language: 'rust' })
    const result = generateRustBoundaries(config)
    expect(result.files).toHaveLength(0)
  })

  it('returns no files for go + hexagonal (language guard)', () => {
    const goDir = createTestProject('go')
    try {
      const config = makeConfig(goDir, {
        language: 'go',
        architectureStyle: 'hexagonal',
      })
      const result = generateRustBoundaries(config)
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
      const result = generateRustBoundaries(config)
      expect(result.files).toHaveLength(0)
    } finally {
      cleanupTestProject(tsDir)
    }
  })

  it('honors skipIfExists when deny.toml already exists', () => {
    const config = makeConfig(dir, {
      language: 'rust',
      architectureStyle: 'hexagonal',
    })
    const targetPath = join(dir, 'deny.toml')
    writeFileSync(targetPath, '# existing')
    const result = generateRustBoundaries(config)
    expect(result.files[0].action).toBe('skipped')
    expect(readFileSync(targetPath, 'utf-8')).toBe('# existing')
  })

  it('honors skipIfExists on second run for all three files', () => {
    const config = makeConfig(dir, {
      language: 'rust',
      architectureStyle: 'hexagonal',
    })
    generateRustBoundaries(config)
    const result = generateRustBoundaries(config)
    expect(result.files[0].action).toBe('skipped')
    expect(result.files[1].action).toBe('skipped')
    expect(result.files[2].action).toBe('skipped')
  })

  // RED tests: strictnessTier gating (#1148 Slice D)

  it('practical: clippy.toml does NOT contain pedantic lint [RED #1148]', () => {
    const config = makeConfig(dir, {
      language: 'rust',
      architectureStyle: 'hexagonal',
      strictnessTier: 'practical',
    })
    generateRustBoundaries(config)
    const content = readFileSync(join(dir, 'clippy.toml'), 'utf-8')
    expect(content).not.toContain('pedantic = "warn"')
  })

  it('pedantic: clippy.toml DOES contain pedantic lint [#1148]', () => {
    const config = makeConfig(dir, {
      language: 'rust',
      architectureStyle: 'hexagonal',
      strictnessTier: 'pedantic',
    })
    generateRustBoundaries(config)
    const content = readFileSync(join(dir, 'clippy.toml'), 'utf-8')
    expect(content).toContain('pedantic = "warn"')
  })

  it('practical: clippy.toml still contains panic-safety baseline lints [#1148]', () => {
    const config = makeConfig(dir, {
      language: 'rust',
      architectureStyle: 'hexagonal',
      strictnessTier: 'practical',
    })
    generateRustBoundaries(config)
    const content = readFileSync(join(dir, 'clippy.toml'), 'utf-8')
    expect(content).toContain('unwrap_used = "warn"')
    expect(content).toContain('panic = "warn"')
  })
})
