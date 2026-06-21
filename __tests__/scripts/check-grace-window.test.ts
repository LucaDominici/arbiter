// SPDX-License-Identifier: Apache-2.0
// Grace-window guard (#1491): the ADR-028 L1→L2 grace window can be turned into an L2 fake-green
// by hand-editing arbiter.json — either an over-long graceEndsAt (far-future date) or a stale
// graceFromLevel=L1 carried into a project now above L2. This guard FAILS closed on both and
// PASSes on NO-DATA (no arbiter.json / no active grace) and a within-bounds window.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-grace-window.mjs')

function run(dir: string, args: string[] = []): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('node', [SCRIPT, '--dir', dir, ...args], { encoding: 'utf-8' })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function makeRepo(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'grace-window-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function writeCfg(dir: string, cfg: Record<string, unknown>): void {
  writeFileSync(join(dir, 'arbiter.json'), JSON.stringify(cfg, null, 2))
}

function daysFromNow(n: number): string {
  return new Date(Date.now() + n * 86400000).toISOString()
}

describe('check-grace-window (anti-fake-green, #1491)', () => {
  it('--help exits 0', () => {
    const { dir, cleanup } = makeRepo()
    try {
      const r = run(dir, ['--help'])
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('Usage')
    } finally {
      cleanup()
    }
  })

  it('NO-DATA when arbiter.json is absent → PASS', () => {
    const { dir, cleanup } = makeRepo()
    try {
      const r = run(dir)
      expect(r.status).toBe(0)
      expect(r.stdout).toMatch(/NO-DATA/)
    } finally {
      cleanup()
    }
  })

  it('no active grace (no graceFromLevel) → PASS', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeCfg(dir, { governanceLevel: 'L2' })
      const r = run(dir)
      expect(r.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('within-bounds L1→L2 grace at L2 → PASS', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeCfg(dir, { governanceLevel: 'L2', graceFromLevel: 'L1', graceEndsAt: daysFromNow(20) })
      const r = run(dir)
      expect(r.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('over-long graceEndsAt (far-future hand edit) → FAIL', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeCfg(dir, { governanceLevel: 'L2', graceFromLevel: 'L1', graceEndsAt: daysFromNow(400) })
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stderr).toMatch(/over-long grace/)
    } finally {
      cleanup()
    }
  })

  it('stale graceFromLevel=L1 on a project now at L3 → FAIL', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeCfg(dir, { governanceLevel: 'L3', graceFromLevel: 'L1', graceEndsAt: daysFromNow(10) })
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stderr).toMatch(/stale grace/)
    } finally {
      cleanup()
    }
  })

  it('expired grace is inert → PASS', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeCfg(dir, { governanceLevel: 'L2', graceFromLevel: 'L1', graceEndsAt: daysFromNow(-5) })
      const r = run(dir)
      expect(r.status).toBe(0)
    } finally {
      cleanup()
    }
  })
})
