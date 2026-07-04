import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-doc-links.mjs')

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
  const dir = mkdtempSync(join(tmpdir(), 'doc-links-test-'))
  mkdirSync(join(dir, 'docs'), { recursive: true })
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function writeCanonicalPaths(dir: string, content: string): void {
  mkdirSync(join(dir, 'docs', 'internal', 'METHOD'), { recursive: true })
  writeFileSync(join(dir, 'docs', 'internal', 'METHOD', 'CANONICAL_PATHS.md'), content)
}

describe('check-doc-links (#255)', () => {
  it('exits 0 when no docs found', () => {
    const { dir, cleanup } = makeDir()
    try {
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 when all local links resolve', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'docs', 'TARGET.md'), '# Target\n')
      writeFileSync(join(dir, 'docs', 'SOURCE.md'), 'See [target](TARGET.md) for details.\n')
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when a local link is broken and no redirect exists', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'docs', 'SOURCE.md'), 'See [missing](MISSING.md) for details.\n')
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('MISSING.md')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when a broken link has a CANONICAL_PATHS redirect to an existing file (AC#5)', () => {
    const { dir, cleanup } = makeDir()
    try {
      mkdirSync(join(dir, 'docs', 'new'), { recursive: true })
      writeFileSync(join(dir, 'docs', 'new', 'FILE.md'), '# Moved here\n')
      writeCanonicalPaths(
        dir,
        '# Canonical Paths\n\n## Aliases\n\n| Old Path | Current Path |\n|---|---|\n| `docs/OLD.md` | `docs/new/FILE.md` |\n',
      )
      writeFileSync(join(dir, 'docs', 'SOURCE.md'), 'See [old doc](OLD.md).\n')
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when a CANONICAL_PATHS redirect target also does not exist', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeCanonicalPaths(
        dir,
        '# Canonical Paths\n\n## Aliases\n\n| Old Path | Current Path |\n|---|---|\n| `docs/OLD.md` | `docs/ALSO_MISSING.md` |\n',
      )
      writeFileSync(join(dir, 'docs', 'SOURCE.md'), 'See [old doc](OLD.md).\n')
      const result = run(dir)
      expect(result.status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('ignores http/https links', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(
        join(dir, 'docs', 'SOURCE.md'),
        'See [external](https://example.com/docs) for details.\n',
      )
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('ignores anchor-only links', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'docs', 'SOURCE.md'), 'See [section](#installation).\n')
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('reports the source file and broken link in output', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'docs', 'SOURCE.md'), 'See [missing](MISSING.md).\n')
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('SOURCE.md')
    } finally {
      cleanup()
    }
  })

  it('respects .docs-links-ignore allowlist', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, '.docs-links-ignore'), 'docs/INTENTIONAL_BROKEN.md\n')
      writeFileSync(
        join(dir, 'docs', 'SOURCE.md'),
        'See [intentionally broken](INTENTIONAL_BROKEN.md).\n',
      )
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })
})
