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
  mkdirSync(join(dir, 'docs', 'internal', 'METHOD'), { recursive: true })
  writeFileSync(join(dir, 'docs', 'internal', 'METHOD', 'SSOT_CORE_SET.md'), content)
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
        '# SSOT\n\n## Method\n\n- `docs/internal/METHOD/SSOT_CORE_SET.md` — this file\n- `docs/SYSTEM/ARCH.md` — architecture\n',
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
        '# SSOT\n\n- Plain text item without backtick paths\n- `docs/internal/METHOD/SSOT_CORE_SET.md` — this file\n',
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
      writeCore(dir, '# SSOT\n\n- `docs/internal/METHOD/SSOT_CORE_SET.md` — this file\n')
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })
})

// #1100: INV-108 — reverse exhaustiveness (qualifying doc on disk MUST be listed)
function writeQualifyingDoc(dir: string, relPath: string, kind = 'method'): void {
  const abs = join(dir, relPath)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(
    abs,
    `---\ntitle: '${relPath}'\nstatus: active\ntags: ['audience/dev', 'kind/${kind}']\n---\n\n# ${relPath}\n`,
  )
}

describe('check-ssot-core exhaustiveness (INV-108, #1100)', () => {
  it('exits 1 when an active backbone doc on disk is absent from SSOT_CORE_SET', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeQualifyingDoc(dir, 'docs/METHOD/LISTED.md')
      writeQualifyingDoc(dir, 'docs/METHOD/UNLISTED.md')
      writeCore(
        dir,
        '# SSOT\n\n<!-- BEGIN GENERATED INVENTORY -->\n- `docs/METHOD/LISTED.md` — listed\n<!-- END GENERATED INVENTORY -->\n',
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stdout + result.stderr).toMatch(/UNLISTED\.md/)
      expect(result.stdout + result.stderr).toMatch(/gen-ssot-core/)
    } finally {
      cleanup()
    }
  })

  it('exits 0 when every qualifying doc is listed', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeQualifyingDoc(dir, 'docs/METHOD/LISTED.md')
      writeCore(
        dir,
        '# SSOT\n\n<!-- BEGIN GENERATED INVENTORY -->\n- `docs/METHOD/LISTED.md` — listed\n<!-- END GENERATED INVENTORY -->\n',
      )
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('does not require non-qualifying docs (kind/reference) to be listed', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeQualifyingDoc(dir, 'docs/REFERENCE/some-ref.md', 'reference')
      writeCore(
        dir,
        '# SSOT\n\n<!-- BEGIN GENERATED INVENTORY -->\n<!-- END GENERATED INVENTORY -->\n',
      )
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })
})
