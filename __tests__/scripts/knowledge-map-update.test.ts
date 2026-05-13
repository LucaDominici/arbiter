import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/knowledge-map-update.mjs')

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
  const dir = mkdtempSync(join(tmpdir(), 'km-update-test-'))
  mkdirSync(join(dir, 'docs', 'METHOD'), { recursive: true })
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function writeKm(dir: string, content: string): void {
  writeFileSync(join(dir, 'docs', 'METHOD', 'KNOWLEDGE_MAP.md'), content)
}

function readKm(dir: string): string {
  return readFileSync(join(dir, 'docs', 'METHOD', 'KNOWLEDGE_MAP.md'), 'utf-8')
}

describe('knowledge-map-update (#255)', () => {
  it('exits 0 when no KNOWLEDGE_MAP.md exists', () => {
    const { dir, cleanup } = makeDir()
    try {
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('updates Lines: 0 to actual line count', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'AGENTS.md'), 'line\n'.repeat(42))
      writeKm(dir, '# KM\n\n## AGENTS.md\n\n**Location:** `AGENTS.md`\n**Lines:** 0\n')
      const result = run(dir)
      expect(result.status).toBe(0)
      const updated = readKm(dir)
      expect(updated).toContain('**Lines:** 42')
    } finally {
      cleanup()
    }
  })

  it('updates stale line count to current value', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'AGENTS.md'), 'line\n'.repeat(100))
      writeKm(dir, '# KM\n\n## AGENTS.md\n\n**Location:** `AGENTS.md`\n**Lines:** 5\n')
      run(dir)
      const updated = readKm(dir)
      expect(updated).toContain('**Lines:** 100')
    } finally {
      cleanup()
    }
  })

  it('preserves all other content in KNOWLEDGE_MAP.md', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'AGENTS.md'), 'line\n'.repeat(10))
      writeKm(
        dir,
        '# KM — my-project\n\n## AGENTS.md\n\n**Location:** `AGENTS.md`\n**Lines:** 0\n**Purpose:** important governance doc\n',
      )
      run(dir)
      const updated = readKm(dir)
      expect(updated).toContain('my-project')
      expect(updated).toContain('important governance doc')
    } finally {
      cleanup()
    }
  })

  it('skips entries where the referenced file does not exist', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeKm(dir, '# KM\n\n## docs/MISSING.md\n\n**Location:** `docs/MISSING.md`\n**Lines:** 0\n')
      const result = run(dir)
      expect(result.status).toBe(0)
      const updated = readKm(dir)
      expect(updated).toContain('**Lines:** 0')
    } finally {
      cleanup()
    }
  })

  it('handles multiple entries', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'AGENTS.md'), 'x\n'.repeat(20))
      mkdirSync(join(dir, 'docs', 'METHOD'), { recursive: true })
      writeFileSync(join(dir, 'docs', 'METHOD', 'SSOT_CORE_SET.md'), 'y\n'.repeat(30))
      writeKm(
        dir,
        '# KM\n\n## AGENTS.md\n\n**Location:** `AGENTS.md`\n**Lines:** 0\n\n---\n\n## docs/METHOD/SSOT_CORE_SET.md\n\n**Location:** `docs/METHOD/SSOT_CORE_SET.md`\n**Lines:** 0\n',
      )
      run(dir)
      const updated = readKm(dir)
      expect(updated).toMatch(/AGENTS\.md[\s\S]*?\*\*Lines:\*\* 20/)
      expect(updated).toMatch(/SSOT_CORE_SET\.md[\s\S]*?\*\*Lines:\*\* 30/)
    } finally {
      cleanup()
    }
  })
})
