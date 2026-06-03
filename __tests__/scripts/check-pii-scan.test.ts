// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-pii-scan.mjs')

function run(patternsPath?: string) {
  const argv = patternsPath ? [SCRIPT, '--patterns', patternsPath] : [SCRIPT]
  const r = spawnSync('node', argv, { encoding: 'utf-8' })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function makeDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'pii-scan-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('check-pii-scan.mjs (PII patterns file integrity — INV-89)', () => {
  it('exits 0 on a valid patterns file (real regex entries)', () => {
    const { dir, cleanup } = makeDir()
    try {
      const file = join(dir, 'pii-patterns.txt')
      writeFileSync(
        file,
        ['# comment header', '', '[a-z0-9]+@[a-z]+\\.[a-z]{2,}', '\\+[1-9]\\d{6,14}', ''].join(
          '\n',
        ),
      )
      const result = run(file)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('OK')
    } finally {
      cleanup()
    }
  })

  it('exits 0 against the real repo patterns file (default path)', () => {
    const result = run()
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('OK')
  })

  it('exits 1 when the patterns file is missing', () => {
    const { dir, cleanup } = makeDir()
    try {
      const result = run(join(dir, 'does-not-exist.txt'))
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('FAIL')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when the patterns file has no pattern entries (comments only)', () => {
    const { dir, cleanup } = makeDir()
    try {
      const file = join(dir, 'pii-patterns.txt')
      writeFileSync(file, ['# only comments', '# nothing else', ''].join('\n'))
      const result = run(file)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('FAIL')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when a pattern line is an invalid regex', () => {
    const { dir, cleanup } = makeDir()
    try {
      const file = join(dir, 'pii-patterns.txt')
      // unbalanced "(" → invalid regex
      writeFileSync(file, ['[a-z]+@[a-z]+', '(unbalanced', ''].join('\n'))
      const result = run(file)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('invalid regex')
    } finally {
      cleanup()
    }
  })

  it('exits 0 on --help and prints usage', () => {
    const r = spawnSync('node', [SCRIPT, '--help'], { encoding: 'utf-8' })
    expect(r.status ?? 1).toBe(0)
    expect(r.stdout ?? '').toContain('Usage:')
  })
})
