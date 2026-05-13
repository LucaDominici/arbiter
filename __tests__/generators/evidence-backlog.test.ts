import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateEvidenceBacklog } from '../../src/generators/evidence-backlog.js'

describe('generateEvidenceBacklog (#243)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('emits .evidence/BACKLOG.md.template at L2', () => {
    const config = makeConfig(dir, { governanceLevel: 'L2' })
    generateEvidenceBacklog(config)
    expect(existsSync(join(dir, '.evidence', 'BACKLOG.md.template'))).toBe(true)
  })

  it('emits .evidence/BACKLOG.md.template at L3', () => {
    const config = makeConfig(dir, { governanceLevel: 'L3' })
    generateEvidenceBacklog(config)
    expect(existsSync(join(dir, '.evidence', 'BACKLOG.md.template'))).toBe(true)
  })

  it('does NOT emit at L1', () => {
    const config = makeConfig(dir, { governanceLevel: 'L1' })
    const result = generateEvidenceBacklog(config)
    expect(result.files).toHaveLength(0)
    expect(existsSync(join(dir, '.evidence', 'BACKLOG.md.template'))).toBe(false)
  })

  it('skipIfExists — does not overwrite existing template', () => {
    const evidenceDir = join(dir, '.evidence')
    mkdirSync(evidenceDir, { recursive: true })
    const target = join(evidenceDir, 'BACKLOG.md.template')
    writeFileSync(target, 'PREEXISTING')
    generateEvidenceBacklog(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(readFileSync(target, 'utf8')).toBe('PREEXISTING')
  })
})
