import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateLocalWrapper } from '../../src/generators/local-wrapper.js'
import { makeConfig } from '../helpers.js'

describe('generateLocalWrapper (#879, W3)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-local-wrapper-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('emits Makefile', () => {
    generateLocalWrapper(makeConfig(dir))
    expect(existsSync(join(dir, 'Makefile'))).toBe(true)
  })

  it('Makefile contains all required targets', () => {
    generateLocalWrapper(makeConfig(dir))
    const content = readFileSync(join(dir, 'Makefile'), 'utf-8')
    for (const target of [
      'help',
      'check',
      'gate',
      'ci',
      'full',
      'simulate-nightly',
      'simulate-weekly',
      'evidence',
      'clean',
    ]) {
      expect(content, `Makefile missing target: ${target}`).toContain(`${target}:`)
    }
  })

  it('ci target delegates to gate', () => {
    generateLocalWrapper(makeConfig(dir))
    const content = readFileSync(join(dir, 'Makefile'), 'utf-8')
    expect(content).toMatch(/^ci:\s*gate/m)
  })

  it('emits run.sh', () => {
    generateLocalWrapper(makeConfig(dir))
    expect(existsSync(join(dir, 'run.sh'))).toBe(true)
  })

  it('run.sh contains exec shim to check-all.mjs', () => {
    generateLocalWrapper(makeConfig(dir))
    const content = readFileSync(join(dir, 'run.sh'), 'utf-8')
    expect(content).toContain('exec node scripts/check-all.mjs')
  })

  it('run.sh is executable (0o755)', () => {
    generateLocalWrapper(makeConfig(dir))
    const mode = statSync(join(dir, 'run.sh')).mode & 0o777
    expect(mode).toBe(0o755)
  })

  it('Makefile is not executable (no execute bits)', () => {
    generateLocalWrapper(makeConfig(dir))
    const mode = statSync(join(dir, 'Makefile')).mode & 0o777
    expect(mode & 0o111).toBe(0)
  })

  it('skipIfExists: second call leaves Makefile untouched (sentinel)', () => {
    generateLocalWrapper(makeConfig(dir))
    writeFileSync(join(dir, 'Makefile'), 'SENTINEL_CONTENT', 'utf-8')
    const result2 = generateLocalWrapper(makeConfig(dir))
    expect(readFileSync(join(dir, 'Makefile'), 'utf-8')).toBe('SENTINEL_CONTENT')
    const makefileResult = result2.files.find((f) => f.path.endsWith('Makefile'))
    expect(makefileResult?.action).toBe('skipped')
  })

  it('skipIfExists: second call leaves run.sh untouched (sentinel)', () => {
    generateLocalWrapper(makeConfig(dir))
    writeFileSync(join(dir, 'run.sh'), 'SENTINEL_CONTENT', 'utf-8')
    const result2 = generateLocalWrapper(makeConfig(dir))
    expect(readFileSync(join(dir, 'run.sh'), 'utf-8')).toBe('SENTINEL_CONTENT')
    const runShResult = result2.files.find((f) => f.path.endsWith('run.sh'))
    expect(runShResult?.action).toBe('skipped')
  })

  it('returns WriteResult array for both files', () => {
    const result = generateLocalWrapper(makeConfig(dir))
    expect(result.files).toHaveLength(2)
    expect(result.files.map((f) => f.action)).toEqual(['created', 'created'])
  })
})
