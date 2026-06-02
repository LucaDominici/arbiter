import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-spdx-headers.mjs')

function run(dir: string) {
  const r = spawnSync('node', [SCRIPT, `--dir=${dir}`], { encoding: 'utf-8' })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function makeDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'spdx-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('check-spdx-headers.mjs (SPDX license header enforcement)', () => {
  it('exits 0 when all .ts files have SPDX header in first 5 lines', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(
        join(dir, 'a.ts'),
        '// SPDX-License-Identifier: Apache-2.0\nexport const a = 1\n',
      )
      writeFileSync(
        join(dir, 'b.ts'),
        '// SPDX-License-Identifier: Apache-2.0\nexport const b = 2\n',
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when a .ts file is missing SPDX header', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'missing.ts'), 'export const x = 1\n')
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('FAIL')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when SPDX header appears after line 5', () => {
    const { dir, cleanup } = makeDir()
    try {
      const lines = ['', '', '', '', '', '// SPDX-License-Identifier: Apache-2.0\n'].join('\n')
      writeFileSync(join(dir, 'late.ts'), lines)
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('FAIL')
    } finally {
      cleanup()
    }
  })

  it('exits 0 with empty directory (no .ts files to check)', () => {
    const { dir, cleanup } = makeDir()
    try {
      mkdirSync(join(dir, 'sub'))
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })
})
