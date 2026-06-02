import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-no-orphan-todo.mjs')

function run(dir: string, scanDir = 'src') {
  const r = spawnSync('node', [SCRIPT, scanDir], { encoding: 'utf-8', cwd: dir })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function makeDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'orphan-todo-'))
  mkdirSync(join(dir, 'src'), { recursive: true })
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('check-no-orphan-todo.mjs (orphan TODO enforcement)', () => {
  it('exits 0 when all TODOs have issue IDs', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(
        join(dir, 'src', 'a.ts'),
        '// TODO(#123): fix this properly\nexport const x = 1\n',
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when a bare TODO without issue ID is found', () => {
    const { dir, cleanup } = makeDir()
    try {
      // Construct dynamically so this source file does not itself trip the checker
      const orphan = '// ' + 'TODO: fix later'
      writeFileSync(join(dir, 'src', 'bad.ts'), `${orphan}\nexport const y = 2\n`)
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('orphan TODO')
    } finally {
      cleanup()
    }
  })

  it('exits 1 for TODO without parens (no issue ID format)', () => {
    const { dir, cleanup } = makeDir()
    try {
      const orphan = '// ' + 'TODO remove this'
      writeFileSync(join(dir, 'src', 'bad2.ts'), `${orphan}\nexport const z = 3\n`)
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('orphan TODO')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when src/ directory is empty', () => {
    const { dir, cleanup } = makeDir()
    try {
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })
})
