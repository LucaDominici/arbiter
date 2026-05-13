import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateCursor } from '../../src/generators/cursor.js'
import { makeConfig } from '../helpers.js'

describe('generateCursor', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-cursor-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('generates .cursorrules file', () => {
    const result = generateCursor(makeConfig(dir))
    expect(result.files).toHaveLength(1)
    expect(result.files[0].path).toContain('.cursorrules')
    expect(result.files[0].action).toBe('created')
  })

  it('.cursorrules content references AGENTS.md', () => {
    generateCursor(makeConfig(dir))
    const content = readFileSync(join(dir, '.cursorrules'), 'utf-8')
    expect(content).toContain('AGENTS.md')
  })

  it('.cursorrules contains project stack info', () => {
    generateCursor(
      makeConfig(dir, {
        projectName: 'cursor-proj',
        buildCommand: 'npm run build',
        testCommand: 'npm test',
      }),
    )
    const content = readFileSync(join(dir, '.cursorrules'), 'utf-8')
    expect(content).toContain('cursor-proj')
    expect(content).toContain('npm run build')
    expect(content).toContain('npm test')
  })
})
