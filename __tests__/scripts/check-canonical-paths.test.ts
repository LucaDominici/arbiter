import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-canonical-paths.mjs')

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
  const dir = mkdtempSync(join(tmpdir(), 'canon-paths-test-'))
  mkdirSync(join(dir, 'docs', 'METHOD'), { recursive: true })
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function writeCanonicalPaths(dir: string, content: string): void {
  writeFileSync(join(dir, 'docs', 'METHOD', 'CANONICAL_PATHS.md'), content)
}

describe('check-canonical-paths (#255)', () => {
  it('exits 0 when no CANONICAL_PATHS.md exists (bootstrap mode)', () => {
    const { dir, cleanup } = makeDir()
    try {
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 when aliases section is empty', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeCanonicalPaths(
        dir,
        '# Canonical Paths\n\n## Aliases\n\n| Old Path | Current Path |\n|---|---|\n',
      )
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 when all redirect targets exist', () => {
    const { dir, cleanup } = makeDir()
    try {
      mkdirSync(join(dir, 'docs', 'new'), { recursive: true })
      writeFileSync(join(dir, 'docs', 'new', 'FILE.md'), '# New\n')
      writeCanonicalPaths(
        dir,
        '# Canonical Paths\n\n## Aliases\n\n| Old Path | Current Path |\n|---|---|\n| `docs/old/FILE.md` | `docs/new/FILE.md` |\n',
      )
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when a redirect target does not exist (dangling alias)', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeCanonicalPaths(
        dir,
        '# Canonical Paths\n\n## Aliases\n\n| Old Path | Current Path |\n|---|---|\n| `docs/old/FILE.md` | `docs/MISSING.md` |\n',
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('docs/MISSING.md')
    } finally {
      cleanup()
    }
  })

  it('reports all dangling aliases', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeCanonicalPaths(
        dir,
        '# Canonical Paths\n\n## Aliases\n\n| Old Path | Current Path |\n|---|---|\n| `docs/a.md` | `docs/MISSING_A.md` |\n| `docs/b.md` | `docs/MISSING_B.md` |\n',
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('docs/MISSING_A.md')
      expect(result.stdout).toContain('docs/MISSING_B.md')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when mix of valid and dangling aliases (dangling wins)', () => {
    const { dir, cleanup } = makeDir()
    try {
      mkdirSync(join(dir, 'docs', 'new'), { recursive: true })
      writeFileSync(join(dir, 'docs', 'new', 'FILE.md'), '# New\n')
      writeCanonicalPaths(
        dir,
        '# Canonical Paths\n\n## Aliases\n\n| Old Path | Current Path |\n|---|---|\n| `docs/a.md` | `docs/new/FILE.md` |\n| `docs/b.md` | `docs/MISSING.md` |\n',
      )
      const result = run(dir)
      expect(result.status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('reports dangling count in output', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeCanonicalPaths(
        dir,
        '# Canonical Paths\n\n## Aliases\n\n| Old Path | Current Path |\n|---|---|\n| `docs/a.md` | `docs/GONE.md` |\n',
      )
      const result = run(dir)
      expect(result.stdout).toMatch(/\d+.*dangling/i)
    } finally {
      cleanup()
    }
  })
})
