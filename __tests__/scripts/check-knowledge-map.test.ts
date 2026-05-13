import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-knowledge-map.mjs')

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
  const dir = mkdtempSync(join(tmpdir(), 'km-check-test-'))
  mkdirSync(join(dir, 'docs', 'METHOD'), { recursive: true })
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function writeKm(dir: string, content: string): void {
  writeFileSync(join(dir, 'docs', 'METHOD', 'KNOWLEDGE_MAP.md'), content)
}

describe('check-knowledge-map (#255)', () => {
  it('exits 0 when no KNOWLEDGE_MAP.md exists (bootstrap mode)', () => {
    const { dir, cleanup } = makeDir()
    try {
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 when no **Lines:** entries exist (old-format KM)', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeKm(dir, '# Knowledge Map\n\n## AGENTS.md\n\n**Location:** `AGENTS.md`\n')
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 when Lines: 0 (not yet populated)', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'AGENTS.md'), '# Agents\n'.repeat(50))
      writeKm(dir, '# KM\n\n## AGENTS.md\n\n**Location:** `AGENTS.md`\n**Lines:** 0\n')
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 when stored count matches actual within tolerance', () => {
    const { dir, cleanup } = makeDir()
    try {
      const lines = 'content line\n'.repeat(100)
      writeFileSync(join(dir, 'AGENTS.md'), lines)
      writeKm(dir, '# KM\n\n## AGENTS.md\n\n**Location:** `AGENTS.md`\n**Lines:** 100\n')
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when stored count drifts beyond tolerance from actual', () => {
    const { dir, cleanup } = makeDir()
    try {
      const lines = 'content line\n'.repeat(100)
      writeFileSync(join(dir, 'AGENTS.md'), lines)
      writeKm(dir, '# KM\n\n## AGENTS.md\n\n**Location:** `AGENTS.md`\n**Lines:** 10\n')
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('AGENTS.md')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when referenced file does not exist (skip missing files)', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeKm(dir, '# KM\n\n## docs/MISSING.md\n\n**Location:** `docs/MISSING.md`\n**Lines:** 50\n')
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('reports drifted files in output', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'AGENTS.md'), 'x\n'.repeat(200))
      writeKm(dir, '# KM\n\n## AGENTS.md\n\n**Location:** `AGENTS.md`\n**Lines:** 5\n')
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('drift')
    } finally {
      cleanup()
    }
  })
})
