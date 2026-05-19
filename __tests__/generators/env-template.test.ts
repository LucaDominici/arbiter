import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateEnvTemplate } from '../../src/generators/env-template.js'
import { makeConfig } from '../helpers.js'

describe('generateEnvTemplate (#879, W3)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-env-template-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('emits .env.example', () => {
    generateEnvTemplate(makeConfig(dir))
    expect(existsSync(join(dir, '.env.example'))).toBe(true)
  })

  it('.env.example contains ARBITER_LEVEL variable', () => {
    generateEnvTemplate(makeConfig(dir))
    const content = readFileSync(join(dir, '.env.example'), 'utf-8')
    expect(content).toContain('ARBITER_LEVEL')
  })

  it('.env.example contains ARBITER_EVIDENCE_DIR variable', () => {
    generateEnvTemplate(makeConfig(dir))
    const content = readFileSync(join(dir, '.env.example'), 'utf-8')
    expect(content).toContain('ARBITER_EVIDENCE_DIR')
  })

  it('.env.example contains NODE_ENV variable', () => {
    generateEnvTemplate(makeConfig(dir))
    const content = readFileSync(join(dir, '.env.example'), 'utf-8')
    expect(content).toContain('NODE_ENV')
  })

  it('.env.example contains comments for each variable', () => {
    generateEnvTemplate(makeConfig(dir))
    const content = readFileSync(join(dir, '.env.example'), 'utf-8')
    const lines = content.split('\n')
    const commentLines = lines.filter((l) => l.startsWith('#'))
    expect(commentLines.length).toBeGreaterThanOrEqual(3)
  })

  it('skipIfExists: second call leaves .env.example untouched (sentinel)', () => {
    generateEnvTemplate(makeConfig(dir))
    writeFileSync(join(dir, '.env.example'), 'SENTINEL_CONTENT', 'utf-8')
    const result2 = generateEnvTemplate(makeConfig(dir))
    expect(readFileSync(join(dir, '.env.example'), 'utf-8')).toBe('SENTINEL_CONTENT')
    expect(result2.files[0]?.action).toBe('skipped')
  })

  it('returns WriteResult array with one entry', () => {
    const result = generateEnvTemplate(makeConfig(dir))
    expect(result.files).toHaveLength(1)
    expect(result.files[0]?.action).toBe('created')
  })
})
