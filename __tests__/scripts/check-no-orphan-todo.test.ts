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

// Run the gate FROM `cwd` with a scan-dir argument that may be relative OR absolute — the
// #2512 regression surface. `cwd` stands in for "the repo root the gate happens to be invoked
// from" and is deliberately UNRELATED to `scanDirArg` so a join()-under-cwd bug cannot
// accidentally resolve to the right place.
function runFrom(cwd: string, scanDirArg: string) {
  const r = spawnSync('node', [SCRIPT, scanDirArg], { encoding: 'utf-8', cwd })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

describe('check-no-orphan-todo.mjs (orphan TODO enforcement)', () => {
  it('exits 0 when all TODOs have issue IDs', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(
        join(dir, 'src', 'a.ts'),
        '// TODO(#123): fix this properly\nexport const x = 1\n',
      )
      const result = run(dir)
      expect(result.status).toBe(0)
      // Programme-membership proof (#2512): a PASS must state how much it actually looked at,
      // not just that it found nothing wrong.
      expect(result.stdout).toContain('Scanned 1 file')
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

  // #2512: an empty scan set used to be indistinguishable from "nothing wrong" — the gate
  // exited 0 either way. This is exactly the CANON-24 "nothing found vs nothing looked at"
  // failure mode, so an empty resolved scan set must now FAIL loudly instead of passing.
  it('FAILS (not passes) when the requested scan dir exists but is empty — programme-membership assertion', () => {
    const { dir, cleanup } = makeDir()
    try {
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('Scanned 0 file')
    } finally {
      cleanup()
    }
  })

  it('FAILS (not passes) when the requested scan dir does not exist at all — programme-membership assertion', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orphan-todo-'))
    try {
      const result = run(dir, 'does-not-exist')
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('Scanned 0 file')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // #2512 root defect: join(process.cwd(), dir) does NOT reset on an absolute `dir` — unlike
  // resolve() — so join('/repo', '/tmp/fixture/src') silently becomes '/repo/tmp/fixture/src',
  // a path that does not exist. The gate then scanned nothing and exited 0: a green that means
  // "I looked nowhere". `cwd` below plays the role of "the repo root" and is a DIFFERENT,
  // unrelated directory from the fixture holding the planted TODO, addressed by ABSOLUTE path —
  // the exact case that silently passed before the fix.
  it('finds an orphan TODO in an ABSOLUTE scan-dir argument instead of silently resolving under cwd', () => {
    const { dir: cwd, cleanup: cleanupCwd } = makeDir()
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'orphan-abs-fixture-'))
    try {
      mkdirSync(join(fixtureRoot, 'src'), { recursive: true })
      const orphan = '// ' + 'TODO: unbound work item'
      writeFileSync(join(fixtureRoot, 'src', 'bad.ts'), `${orphan}\nexport const a = 1\n`)
      const absScanDir = join(fixtureRoot, 'src')
      const result = runFrom(cwd, absScanDir)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('orphan TODO')
      expect(result.stdout).toContain('Scanned 1 file')
    } finally {
      cleanupCwd()
      rmSync(fixtureRoot, { recursive: true, force: true })
    }
  })

  it('exits 0 on a CLEAN tree addressed by an ABSOLUTE scan-dir argument, having actually scanned it', () => {
    const { dir: cwd, cleanup: cleanupCwd } = makeDir()
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'orphan-abs-fixture-'))
    try {
      mkdirSync(join(fixtureRoot, 'src'), { recursive: true })
      writeFileSync(
        join(fixtureRoot, 'src', 'ok.ts'),
        '// TODO(#123): fix this properly\nexport const a = 1\n',
      )
      const absScanDir = join(fixtureRoot, 'src')
      const result = runFrom(cwd, absScanDir)
      expect(result.status).toBe(0)
      // Must report a REAL non-zero scan count — not the vacuous "0 files, 0 violations" pass
      // the pre-fix join() bug produced for every absolute scan-dir argument.
      expect(result.stdout).toContain('Scanned 1 file')
    } finally {
      cleanupCwd()
      rmSync(fixtureRoot, { recursive: true, force: true })
    }
  })
})
