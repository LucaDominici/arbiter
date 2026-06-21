// SPDX-License-Identifier: Apache-2.0
// TDD: fail-closed freshness banner for the gold-audit (epic #1469, Wave B #1473).
// freshness() is an OUT-OF-BAND signal over the value-check report files — it never enters the
// scored (byte-deterministic) payload; mtime lives only here. Absent/old ⇒ fail-closed STALE.
import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const MJS_PATH = join(REPO_ROOT, 'scripts/lib/gold-audit-lib.mjs')

let lib: {
  freshness: (
    registry: unknown,
    root: string,
    opts?: { staleHours?: number; now?: number },
  ) => {
    status: string
    counts: { total: number; present: number; fresh: number }
    reports: unknown[]
  }
  evaluate: (registry: unknown, overlays: Set<string>, root: string, options?: unknown) => unknown
}

beforeAll(async () => {
  lib = (await import(MJS_PATH)) as typeof lib
})

const HOUR = 3600 * 1000
const NOW = 1_700_000_000_000 // fixed injected clock — deterministic test

/** A registry of two value-checks reading pre-generated reports + one non-report check. */
const REGISTRY = {
  version: '1.0.0',
  checks: [
    {
      id: 'V-COV',
      type: 'value',
      args: { path: 'reports/coverage.json', format: 'json', select: 'pct', op: 'gte' },
    },
    {
      id: 'V-XML',
      type: 'value',
      args: { path: 'reports/checkstyle.xml', format: 'xml', select: 'count:error', op: 'lte' },
    },
    { id: 'F-DOC', type: 'file_exists', args: { path: 'README.md' } }, // not a report — ignored by freshness
    { id: 'V-LEGACY', type: 'value', args: { path: 'src/x.ts', equals: 'VERSION' } }, // legacy value, no format — ignored
  ],
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gold-fresh-'))
  mkdirSync(join(dir, 'reports'), { recursive: true })
  return dir
}

/** Write a report file and set its mtime to `ageHours` before NOW. */
function writeReport(dir: string, rel: string, ageHours: number): void {
  const abs = join(dir, rel)
  writeFileSync(abs, '{}\n')
  const t = (NOW - ageHours * HOUR) / 1000
  utimesSync(abs, t, t)
}

describe('freshness banner (#1473)', () => {
  it('FRESH when every value-check report is present and within the window', () => {
    const dir = makeRepo()
    try {
      writeReport(dir, 'reports/coverage.json', 1)
      writeReport(dir, 'reports/checkstyle.xml', 5)
      const f = lib.freshness(REGISTRY, dir, { staleHours: 24, now: NOW })
      expect(f.status).toBe('FRESH')
      expect(f.counts).toEqual({ total: 2, present: 2, fresh: 2 })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('STALE when ZERO report files are present (the tools never ran — fail-closed)', () => {
    const dir = makeRepo()
    try {
      const f = lib.freshness(REGISTRY, dir, { staleHours: 24, now: NOW })
      expect(f.status).toBe('STALE')
      expect(f.counts.present).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('PARTIAL when some reports are missing', () => {
    const dir = makeRepo()
    try {
      writeReport(dir, 'reports/coverage.json', 1) // only one of two present
      const f = lib.freshness(REGISTRY, dir, { staleHours: 24, now: NOW })
      expect(f.status).toBe('PARTIAL')
      expect(f.counts).toEqual({ total: 2, present: 1, fresh: 1 })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('PARTIAL when a present report is older than the window', () => {
    const dir = makeRepo()
    try {
      writeReport(dir, 'reports/coverage.json', 1)
      writeReport(dir, 'reports/checkstyle.xml', 48) // older than 24h window
      const f = lib.freshness(REGISTRY, dir, { staleHours: 24, now: NOW })
      expect(f.status).toBe('PARTIAL')
      expect(f.counts).toEqual({ total: 2, present: 2, fresh: 1 })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('FRESH (vacuous) when the registry declares no value-check reports', () => {
    const dir = makeRepo()
    try {
      const noReports = { checks: [{ id: 'F', type: 'file_exists', args: { path: 'README.md' } }] }
      const f = lib.freshness(noReports, dir, { staleHours: 24, now: NOW })
      expect(f.status).toBe('FRESH')
      expect(f.counts.total).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('mtime / wall-clock NEVER leaks into the scored payload', () => {
    const dir = makeRepo()
    try {
      writeReport(dir, 'reports/coverage.json', 1)
      const scored = JSON.stringify(lib.evaluate(REGISTRY, new Set<string>(), dir))
      expect(scored).not.toContain('mtime')
      expect(scored).not.toContain('ageHours')
      expect(scored).not.toContain(String(NOW))
      // the scored payload is byte-identical across two runs (freshness is out-of-band)
      const again = JSON.stringify(lib.evaluate(REGISTRY, new Set<string>(), dir))
      expect(again).toBe(scored)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
