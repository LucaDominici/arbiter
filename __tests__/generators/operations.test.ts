import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateOperations } from '../../src/generators/operations.js'

describe('generateOperations (#717)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('generates docs/OPERATIONS_HANDBOOK.md', () => {
    generateOperations(makeConfig(dir))
    expect(existsSync(join(dir, 'docs', 'OPERATIONS_HANDBOOK.md'))).toBe(true)
  })

  it('generated file contains project name', () => {
    generateOperations(makeConfig(dir))
    const content = readFileSync(join(dir, 'docs', 'OPERATIONS_HANDBOOK.md'), 'utf-8')
    expect(content).toContain('test-project')
  })

  it('generated file contains 4-signal observability', () => {
    generateOperations(makeConfig(dir, { archetype: 'backend-web-db' }))
    const content = readFileSync(join(dir, 'docs', 'OPERATIONS_HANDBOOK.md'), 'utf-8')
    expect(content.toLowerCase()).toContain('latency')
    expect(content.toLowerCase()).toContain('saturation')
  })

  it('is skipIfExists — does not overwrite existing file', () => {
    const result1 = generateOperations(makeConfig(dir))
    const file1 = result1.files[0]
    expect(file1.action).toBe('created')

    const result2 = generateOperations(makeConfig(dir))
    const file2 = result2.files[0]
    expect(file2.action).toBe('skipped')
  })
})
