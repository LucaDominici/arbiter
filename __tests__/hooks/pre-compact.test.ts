// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeTaskStateFile } from '../helpers.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const HOOK = join(__dirname, '..', '..', '.claude', 'hooks', 'pre-compact.mjs')

function runHook(cwd: string): string {
  return execFileSync('node', [HOOK], { cwd, encoding: 'utf-8' })
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-precompact-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir })
  mkdirSync(join(dir, '.claude'), { recursive: true })
  return dir
}

describe('pre-compact hook (#694 BACKLOG inclusion)', () => {
  let dir: string
  beforeEach(() => {
    dir = makeRepo()
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('emits SESSION STATE banner regardless of BACKLOG presence', () => {
    const out = runHook(dir)
    expect(out).toMatch(/SESSION STATE/)
  })

  it('includes BACKLOG.md content between markers when file present', () => {
    writeTaskStateFile(dir, { taskId: '#694' })
    const evDir = join(dir, '.arbiter', 'evidence', '_694')
    mkdirSync(evDir, { recursive: true })
    writeFileSync(join(evDir, 'BACKLOG.md'), '# Layer 1\n- todo recovery item\n')
    const out = runHook(dir)
    expect(out).toMatch(/BACKLOG \(recovery layer 1\)/)
    expect(out).toMatch(/todo recovery item/)
    expect(out).toMatch(/END BACKLOG/)
  })

  it('omits BACKLOG section when file missing', () => {
    writeTaskStateFile(dir, { taskId: '#001' })
    const out = runHook(dir)
    expect(out).not.toMatch(/BACKLOG \(recovery layer 1\)/)
  })

  it('resolves sanitized path for taskId containing #', () => {
    writeTaskStateFile(dir, { taskId: '#999' })
    const evDir = join(dir, '.arbiter', 'evidence', '_999')
    mkdirSync(evDir, { recursive: true })
    writeFileSync(join(evDir, 'BACKLOG.md'), 'sanitized-found\n')
    const out = runHook(dir)
    expect(out).toMatch(/sanitized-found/)
  })
})
