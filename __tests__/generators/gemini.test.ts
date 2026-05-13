import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateGemini } from '../../src/generators/gemini.js'
import { makeConfig } from '../helpers.js'

describe('generateGemini', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-gemini-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('generates .gemini/GEMINI.md file', () => {
    const result = generateGemini(makeConfig(dir))
    expect(result.files).toHaveLength(1)
    expect(result.files[0].path).toContain('.gemini')
    expect(result.files[0].path).toContain('GEMINI.md')
    expect(result.files[0].action).toBe('created')
  })

  it('GEMINI.md content references AGENTS.md', () => {
    generateGemini(makeConfig(dir))
    const content = readFileSync(join(dir, '.gemini', 'GEMINI.md'), 'utf-8')
    expect(content).toContain('AGENTS.md')
  })

  it('GEMINI.md contains project stack info', () => {
    generateGemini(
      makeConfig(dir, {
        projectName: 'gemini-proj',
        buildCommand: 'npm run build',
        testCommand: 'npm test',
      }),
    )
    const content = readFileSync(join(dir, '.gemini', 'GEMINI.md'), 'utf-8')
    expect(content).toContain('gemini-proj')
    expect(content).toContain('npm run build')
    expect(content).toContain('npm test')
  })
})
