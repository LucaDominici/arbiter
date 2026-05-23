import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateQuality } from '../../src/generators/quality.js'
import { makeConfig } from '../helpers.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'arbiter-quality-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('generateQuality — sonar-project.properties (#211)', () => {
  it('emits sonar-project.properties for Java at L2 with JaCoCo path', () => {
    generateQuality(makeConfig(dir, { language: 'java', governanceLevel: 'L2' }))
    const path = join(dir, 'sonar-project.properties')
    expect(existsSync(path)).toBe(true)
    const content = readFileSync(path, 'utf-8')
    expect(content).toContain('sonar.coverage.jacoco.xmlReportPaths')
    expect(content).not.toContain('lcov.info')
  })

  it('emits sonar-project.properties for TypeScript at L2 with lcov path', () => {
    generateQuality(makeConfig(dir, { language: 'typescript', governanceLevel: 'L2' }))
    const path = join(dir, 'sonar-project.properties')
    expect(existsSync(path)).toBe(true)
    const content = readFileSync(path, 'utf-8')
    expect(content).toContain('sonar.javascript.lcov.reportPaths=coverage/lcov.info')
    expect(content).not.toContain('jacoco')
  })

  it('does not emit for Go (unsupported language)', () => {
    generateQuality(makeConfig(dir, { language: 'go', governanceLevel: 'L2' }))
    expect(existsSync(join(dir, 'sonar-project.properties'))).toBe(false)
  })

  it('does not emit for Rust (unsupported language)', () => {
    generateQuality(makeConfig(dir, { language: 'rust', governanceLevel: 'L2' }))
    expect(existsSync(join(dir, 'sonar-project.properties'))).toBe(false)
  })

  it('does not emit at L1', () => {
    generateQuality(makeConfig(dir, { language: 'java', governanceLevel: 'L1' }))
    expect(existsSync(join(dir, 'sonar-project.properties'))).toBe(false)
  })

  it('emits at L3', () => {
    generateQuality(makeConfig(dir, { language: 'typescript', governanceLevel: 'L3' }))
    expect(existsSync(join(dir, 'sonar-project.properties'))).toBe(true)
  })

  it('emits at L4', () => {
    generateQuality(makeConfig(dir, { language: 'java', governanceLevel: 'L4' }))
    expect(existsSync(join(dir, 'sonar-project.properties'))).toBe(true)
  })

  it('does not overwrite existing file (skipIfExists)', () => {
    const path = join(dir, 'sonar-project.properties')
    const original = 'existing-content'
    require('node:fs').writeFileSync(path, original)
    generateQuality(makeConfig(dir, { language: 'java', governanceLevel: 'L2' }))
    expect(readFileSync(path, 'utf-8')).toBe(original)
  })
})
