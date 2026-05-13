import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-ssot-core.mjs')

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
  const dir = mkdtempSync(join(tmpdir(), 'ssot-core-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function writeCore(dir: string, content: string): void {
  mkdirSync(join(dir, 'docs', 'METHOD'), { recursive: true })
  writeFileSync(join(dir, 'docs', 'METHOD', 'SSOT_CORE_SET.md'), content)
}

describe('check-ssot-core (#255)', () => {
  it('exits 0 when no SSOT_CORE_SET.md found (bootstrap mode)', () => {
    const { dir, cleanup } = makeDir()
    try {
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 when all listed files exist', () => {
    const { dir, cleanup } = makeDir()
    try {
      mkdirSync(join(dir, 'docs', 'SYSTEM'), { recursive: true })
      writeFileSync(join(dir, 'docs', 'SYSTEM', 'ARCH.md'), '# Arch\n')
      writeCore(
        dir,
        '# SSOT\n\n## Method\n\n- `docs/METHOD/SSOT_CORE_SET.md` — this file\n- `docs/SYSTEM/ARCH.md` — architecture\n',
      )
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when a listed file is missing', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeCore(dir, '# SSOT\n\n## Method\n\n- `docs/MISSING/FILE.md` — missing file\n')
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('docs/MISSING/FILE.md')
    } finally {
      cleanup()
    }
  })

  it('exits 1 and reports all missing files', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeCore(dir, '# SSOT\n\n- `docs/A.md` — first\n- `docs/B.md` — second\n')
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('docs/A.md')
      expect(result.stdout).toContain('docs/B.md')
    } finally {
      cleanup()
    }
  })

  it('ignores non-file-path bullet items', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeCore(
        dir,
        '# SSOT\n\n- Plain text item without backtick paths\n- `docs/METHOD/SSOT_CORE_SET.md` — this file\n',
      )
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('reports count of missing entries in output', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeCore(dir, '# SSOT\n\n- `docs/A.md` — a\n- `docs/B.md` — b\n')
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stdout).toMatch(/\d+.*missing/i)
    } finally {
      cleanup()
    }
  })

  it('handles SSOT_CORE_SET.md self-reference gracefully', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeCore(dir, '# SSOT\n\n- `docs/METHOD/SSOT_CORE_SET.md` — this file\n')
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })
})
