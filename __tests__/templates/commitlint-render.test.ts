import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

const data = makeConfig('/tmp/test') as unknown as Record<string, unknown>

describe('commitlint.config.js.ejs (#202)', () => {
  let out: string

  beforeEach(() => {
    out = renderTemplate('root/commitlint.config.js.ejs', data)
  })

  it('renders without EJS leaks', () => {
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
  })

  it('contains @commitlint/config-conventional', () => {
    expect(out).toContain('@commitlint/config-conventional')
  })

  it('is valid JavaScript (contains module.exports)', () => {
    expect(out).toContain('module.exports')
  })

  it('keeps the L1 commitlint command blocking a malformed message (#2767)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-commitlint-'))
    const message = join(dir, 'COMMIT_EDITMSG')
    try {
      writeFileSync(message, 'bad commit message\n')
      const result = spawnSync('npx', ['commitlint', '--edit', message], {
        cwd: resolve('.'),
        encoding: 'utf-8',
      })
      expect(result.status).not.toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps the self commit-msg hook blocking a malformed message (#2767)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-commit-msg-'))
    const message = join(dir, 'COMMIT_EDITMSG')
    try {
      writeFileSync(message, 'bad commit message\n')
      const result = spawnSync('bash', [resolve('.githooks/commit-msg'), message], {
        cwd: resolve('.'),
        encoding: 'utf-8',
      })
      expect(result.status).not.toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
