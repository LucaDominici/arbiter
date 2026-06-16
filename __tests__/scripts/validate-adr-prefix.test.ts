import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/validate-adr-prefix.mjs')

function run(dir: string, args: string[] = []): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8', cwd: dir })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function makeAdrRepo(files: string[]): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'adr-prefix-'))
  mkdirSync(join(dir, 'docs', 'ADR'), { recursive: true })
  for (const f of files) writeFileSync(join(dir, 'docs', 'ADR', f), '# adr\n')
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('validate-adr-prefix (#1415)', () => {
  it('--help exits 0', () => {
    const { dir, cleanup } = makeAdrRepo([])
    try {
      const r = run(dir, ['--help'])
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('Usage')
    } finally {
      cleanup()
    }
  })

  it('accepts a clean set of <PREFIX>-NNN_slug.md files', () => {
    const { dir, cleanup } = makeAdrRepo([
      'ARB-001_thin-pointer.md',
      'ARB-002_gh-cli.md',
      'README.md',
    ])
    try {
      const r = run(dir, ['--prefix', 'ARB'])
      expect(r.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('accepts legacy bare-numeric files alongside prefixed (dual recognition)', () => {
    const { dir, cleanup } = makeAdrRepo(['001-agents.md', 'ARB-002_gh-cli.md', 'README.md'])
    try {
      const r = run(dir, ['--prefix', 'ARB'])
      expect(r.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('rejects a wrong prefix when --prefix is supplied', () => {
    const { dir, cleanup } = makeAdrRepo(['WRONG-001_x.md', 'README.md'])
    try {
      const r = run(dir, ['--prefix', 'ARB'])
      expect(r.status).toBe(1)
      expect(r.stdout + r.stderr).toMatch(/WRONG-001/)
    } finally {
      cleanup()
    }
  })

  it('rejects a duplicate ADR number', () => {
    const { dir, cleanup } = makeAdrRepo(['ARB-001_a.md', 'ARB-001_b.md', 'README.md'])
    try {
      const r = run(dir, ['--prefix', 'ARB'])
      expect(r.status).toBe(1)
      expect(r.stdout + r.stderr).toMatch(/duplicate/i)
    } finally {
      cleanup()
    }
  })

  it('is deterministic for identical inputs', () => {
    const { dir, cleanup } = makeAdrRepo(['ARB-001_a.md', 'ARB-002_b.md', 'README.md'])
    try {
      const a = run(dir, ['--prefix', 'ARB', '--json']).stdout
      const b = run(dir, ['--prefix', 'ARB', '--json']).stdout
      expect(a).toBe(b)
    } finally {
      cleanup()
    }
  })
})
