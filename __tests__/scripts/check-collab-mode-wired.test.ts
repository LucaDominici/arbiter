import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-collab-mode-wired.mjs')

function run(dir: string) {
  const r = spawnSync('node', [SCRIPT], { encoding: 'utf-8', cwd: dir })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function makeDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'collab-mode-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('check-collab-mode-wired.mjs (INV-100)', () => {
  it('exits 0 for trunk-solo collaborationMode', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ collaborationMode: 'trunk-solo' }))
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 for peer-review collaborationMode', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ collaborationMode: 'peer-review' }))
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when collaborationMode is invalid value', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ collaborationMode: 'bogus-mode' }))
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('not a valid value')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when collaborationMode field is absent', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ someOtherField: true }))
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('collaborationMode')
    } finally {
      cleanup()
    }
  })

  it('exits 0 for gated-review collaborationMode', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeFileSync(
        join(dir, 'arbiter.json'),
        JSON.stringify({ collaborationMode: 'gated-review' }),
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 (skip) when arbiter.json is absent — non-arbiter project', () => {
    const { dir, cleanup } = makeDir()
    try {
      // No arbiter.json — gate skips rather than fails (non-arbiter project)
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('passes against the real arbiter.json', () => {
    const result = run(resolve('.'))
    expect(result.status).toBe(0)
  })
})
