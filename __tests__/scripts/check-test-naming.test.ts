// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-test-naming.mjs')

function run(cwd: string) {
  const r = spawnSync('node', [SCRIPT], {
    encoding: 'utf-8',
    cwd,
  })
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  }
}

function makeTemp(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'naming-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('check-test-naming.mjs (test file naming convention)', () => {
  it('exits 0 when run from repo root against the real __tests__ and src', () => {
    const result = run(resolve('.'))
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('All test files follow naming convention')
  })

  it('exits 1 when a .ts file in __tests__ has test patterns but wrong name', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, '__tests__'))
      writeFileSync(
        join(dir, '__tests__', 'invalid.ts'),
        `import { describe, it } from 'vitest'\ndescribe('example', () => { it('works', () => {}) })`,
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('[NAMING]')
      expect(result.stderr).toContain('test file must be named *.test.ts or *.spec.ts')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when test files in __tests__ follow *.test.ts convention', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, '__tests__'))
      writeFileSync(
        join(dir, '__tests__', 'valid.test.ts'),
        `import { describe, it } from 'vitest'\ndescribe('example', () => { it('works', () => {}) })`,
      )
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 when test files follow *.spec.ts convention', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, '__tests__'))
      writeFileSync(
        join(dir, '__tests__', 'valid.spec.ts'),
        `import { describe, it } from 'vitest'\ndescribe('example', () => { it('works', () => {}) })`,
      )
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when src contains a .ts file with vitest imports but wrong name', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'src'))
      writeFileSync(
        join(dir, 'src', 'bad-name.ts'),
        `import { describe, it } from 'vitest'\nexport const x = 1`,
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('[NAMING]')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when .d.ts files are present (skipped regardless of name)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, '__tests__'))
      writeFileSync(join(dir, '__tests__', 'types.d.ts'), `declare module 'vitest' { }`)
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 with empty src and __tests__ directories', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'src'))
      mkdirSync(join(dir, '__tests__'))
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when file has jest imports but wrong naming', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, '__tests__'))
      writeFileSync(
        join(dir, '__tests__', 'jest-style.ts'),
        `import { describe, it } from '@jest/globals'\ndescribe('x', () => {})`,
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('[NAMING]')
    } finally {
      cleanup()
    }
  })
})
