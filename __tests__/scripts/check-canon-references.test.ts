// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-canon-references.mjs')

function run(dir: string): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('node', [SCRIPT], {
    encoding: 'utf-8',
    cwd: dir,
  })
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function makeDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'canon-refs-test-'))
  mkdirSync(join(dir, 'docs', 'internal', 'SYSTEM'), { recursive: true })
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})

describe('check-canon-references', () => {
  it('exits 0 when all CANON-NN cross-references are defined', () => {
    const { dir, cleanup } = makeDir()
    cleanups.push(cleanup)
    writeFileSync(
      join(dir, 'docs', 'internal', 'SYSTEM', 'CANON.md'),
      '## CANON-01\n\nSome text.\n\n## CANON-02\n\nReferences CANON-01 here.\n',
    )
    const { status, stdout } = run(dir)
    expect(status).toBe(0)
    expect(stdout).toContain('2 CANON entries defined')
    expect(stdout).toContain('all cross-references valid')
  })

  it('exits 1 when CANON.md contains an undefined CANON-NN reference', () => {
    const { dir, cleanup } = makeDir()
    cleanups.push(cleanup)
    writeFileSync(
      join(dir, 'docs', 'internal', 'SYSTEM', 'CANON.md'),
      '## CANON-01\n\nReferences CANON-99 which does not exist.\n',
    )
    const { status } = run(dir)
    expect(status).toBe(1)
  })

  it('exits 1 when CANON.md has no CANON-NN headings (empty / corrupt guard)', () => {
    const { dir, cleanup } = makeDir()
    cleanups.push(cleanup)
    writeFileSync(join(dir, 'docs', 'internal', 'SYSTEM', 'CANON.md'), 'No headings here.\n')
    const { status, stderr } = run(dir)
    expect(status).toBe(1)
    expect(stderr).toContain('no CANON-NN headings found')
  })
})
