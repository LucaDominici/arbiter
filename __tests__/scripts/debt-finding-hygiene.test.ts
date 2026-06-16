// SPDX-License-Identifier: Apache-2.0
// #1405 — openFindingsCount + unpromotedFindingsAge ratchet (finding-hygiene).
//
// The findings spool (`.arbiter/findings/*.jsonl`, #1401) is the SSOT for
// incidental findings. These metrics reward DRAINING the spool (lower=better);
// they MUST NOT let filing findings inflate a green signal (anti-gaming, INV-114).
// Spool absent → the metric is omitted (NA), never a regression.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const DEBT_REPORT = resolve('scripts/debt-report.mjs')

function makeTemp(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'finding-hygiene-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/** Write a findings spool shard with the given finding entries. */
function writeSpool(dir: string, shard: string, entries: Array<Record<string, unknown>>): void {
  const findingsDir = join(dir, '.arbiter', 'findings')
  mkdirSync(findingsDir, { recursive: true })
  const body = entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : '')
  writeFileSync(join(findingsDir, `${shard}.jsonl`), body, 'utf-8')
}

/**
 * Plant a fake `node_modules/jscpd` in the fixture so resolveJscpdSpawn finds it
 * first and runs it directly (no live jscpd, no glibc path). Its bin writes a
 * valid 1-source 0% report so duplicationPercentage collects without erroring,
 * isolating the openFindingsCount ratchet under test.
 */
function installJscpdShim(dir: string): void {
  const pkgDir = join(dir, 'node_modules', 'jscpd')
  mkdirSync(pkgDir, { recursive: true })
  writeFileSync(
    join(pkgDir, 'package.json'),
    JSON.stringify({ name: 'jscpd', version: '5.0.6', bin: { jscpd: './run.js' } }),
  )
  const report = { statistics: { total: { sources: 1, percentage: 0 } } }
  writeFileSync(
    join(pkgDir, 'run.js'),
    [
      `const { mkdirSync, writeFileSync } = require('fs')`,
      `mkdirSync('report', { recursive: true })`,
      `writeFileSync('report/jscpd-report.json', ${JSON.stringify(JSON.stringify(report))})`,
      `process.exit(0)`,
    ].join('\n'),
  )
}

function findingAt(daysAgo: number, fp: string): Record<string, unknown> {
  const ts = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString()
  return {
    ts,
    note: `finding ${fp}`,
    kind: 'smell',
    severity: 'low',
    foundDuring: 'task/#x',
    file: 'src/a.ts',
    line: 1,
    sha: 'deadbeef',
    fingerprint: fp,
  }
}

// ─── collectFindingsMetrics (debt-lib) ────────────────────────────────────────
describe('collectFindingsMetrics (#1405 finding-hygiene spool reader)', () => {
  async function load() {
    return await import('../../scripts/debt-lib.mjs')
  }

  it('is exported from debt-lib', async () => {
    const lib = await load()
    expect(typeof lib.collectFindingsMetrics).toBe('function')
  })

  it('OMITS both metrics when the spool is absent (NA, never a regression)', async () => {
    const { dir, cleanup } = makeTemp()
    try {
      const { collectFindingsMetrics } = await load()
      const m = collectFindingsMetrics(dir)
      expect(m.openFindingsCount).toBeUndefined()
      expect(m.unpromotedFindingsAge).toBeUndefined()
    } finally {
      cleanup()
    }
  })

  it('counts open findings across shards (lower-is-better)', async () => {
    const { dir, cleanup } = makeTemp()
    try {
      const { collectFindingsMetrics } = await load()
      writeSpool(dir, 'shard-a', [findingAt(1, 'fp1'), findingAt(2, 'fp2')])
      writeSpool(dir, 'shard-b', [findingAt(3, 'fp3')])
      const m = collectFindingsMetrics(dir)
      expect(m.openFindingsCount?.value).toBe(3)
      expect(m.openFindingsCount?.direction).toBe('lower-is-better')
    } finally {
      cleanup()
    }
  })

  it('dedups identical fingerprints across shards (no double-count)', async () => {
    const { dir, cleanup } = makeTemp()
    try {
      const { collectFindingsMetrics } = await load()
      writeSpool(dir, 'shard-a', [findingAt(1, 'dupfp')])
      writeSpool(dir, 'shard-b', [findingAt(5, 'dupfp')])
      const m = collectFindingsMetrics(dir)
      expect(m.openFindingsCount?.value).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('reports the oldest unpromoted finding age in days (lower-is-better)', async () => {
    const { dir, cleanup } = makeTemp()
    try {
      const { collectFindingsMetrics } = await load()
      writeSpool(dir, 'shard-a', [findingAt(2, 'fp1'), findingAt(9, 'fp2')])
      const m = collectFindingsMetrics(dir)
      // oldest is 9 days; allow floor rounding tolerance
      expect(m.unpromotedFindingsAge?.value).toBeGreaterThanOrEqual(9)
      expect(m.unpromotedFindingsAge?.value).toBeLessThan(10)
      expect(m.unpromotedFindingsAge?.direction).toBe('lower-is-better')
    } finally {
      cleanup()
    }
  })

  it('treats an empty spool dir as zero open findings (drained, age 0)', async () => {
    const { dir, cleanup } = makeTemp()
    try {
      const { collectFindingsMetrics } = await load()
      mkdirSync(join(dir, '.arbiter', 'findings'), { recursive: true })
      const m = collectFindingsMetrics(dir)
      expect(m.openFindingsCount?.value).toBe(0)
      expect(m.unpromotedFindingsAge?.value).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('ignores malformed JSONL lines (resilient, never crashes)', async () => {
    const { dir, cleanup } = makeTemp()
    try {
      const { collectFindingsMetrics } = await load()
      const findingsDir = join(dir, '.arbiter', 'findings')
      mkdirSync(findingsDir, { recursive: true })
      writeFileSync(
        join(findingsDir, 'shard-a.jsonl'),
        JSON.stringify(findingAt(1, 'fp1')) + '\nnot-json\n{broken\n',
        'utf-8',
      )
      const m = collectFindingsMetrics(dir)
      expect(m.openFindingsCount?.value).toBe(1)
    } finally {
      cleanup()
    }
  })
})

// ─── debt-report --gate ratchet ───────────────────────────────────────────────
// openFindingsCount is lower-is-better: it regresses if it RISES vs baseline
// (findings filed without draining). It improves when findings are drained.
describe('debt-report.mjs --gate (openFindingsCount ratchet, #1405)', () => {
  function setupProject(dir: string, baselineOpen: number, spoolFindings: number): void {
    const scriptsDir = join(dir, 'scripts')
    mkdirSync(scriptsDir, { recursive: true })
    // FIXTURE baseline (deterministic) — only the openFindingsCount metric so the
    // collectMetrics tool-shelling metrics show as "missing tool" (never fail).
    writeFileSync(
      join(scriptsDir, 'debt-baseline.json'),
      JSON.stringify({
        version: 2,
        capturedAt: '2026-01-01T00:00:00Z',
        commit: 'fixture',
        archetype: 'library',
        metrics: {
          openFindingsCount: { value: baselineOpen, unit: 'count', direction: 'lower-is-better' },
        },
      }),
    )
    // Valid jscpd config + fake jscpd shim so the scan succeeds deterministically
    // (0% dup) without live jscpd, isolating the openFindingsCount ratchet.
    writeFileSync(join(dir, '.jscpd.json'), JSON.stringify({ path: ['src'], reporters: ['json'] }))
    installJscpdShim(dir)
    const entries: Array<Record<string, unknown>> = []
    for (let i = 0; i < spoolFindings; i++) entries.push(findingAt(i + 1, `fp${i}`))
    if (spoolFindings > 0) writeSpool(dir, 'shard', entries)
    else mkdirSync(join(dir, '.arbiter', 'findings'), { recursive: true })
  }

  function runGate(cwd: string, binDir: string) {
    const r = spawnSync('node', [DEBT_REPORT, '--gate'], {
      encoding: 'utf-8',
      cwd,
      // Make all collectMetrics tool spawns (npx/vitest/eslint/tsc/knip) fail fast
      // so they show as "missing tool" rows, never as collection errors.
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
    })
    return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
  }

  function fakeBin(dir: string): string {
    const binDir = join(dir, 'fake-bin')
    mkdirSync(binDir, { recursive: true })
    // Emit the npx "missing packages" signature so jscpdScan soft-skips (tool
    // not installed) instead of erroring on a missing report (fail-closed).
    writeFileSync(
      join(binDir, 'npx'),
      '#!/bin/sh\necho "npm error npx canceled due to missing packages and no YES option" 1>&2\nexit 1\n',
    )
    spawnSync('chmod', ['+x', join(binDir, 'npx')])
    return binDir
  }

  it('REGRESSES (exit 1) when openFindingsCount rises above baseline without drain', () => {
    const { dir, cleanup } = makeTemp()
    try {
      // baseline 1 open finding; spool now has 4 → regression
      setupProject(dir, 1, 4)
      const result = runGate(dir, fakeBin(dir))
      expect(result.status).toBe(1)
      expect(result.stdout).toMatch(/openFindingsCount/)
      expect(result.stdout).toMatch(/regressed/)
    } finally {
      cleanup()
    }
  })

  it('PASSES (exit 0) when findings are drained below baseline (improvement)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      // baseline 4; spool now drained to 1 → improvement, gate passes
      setupProject(dir, 4, 1)
      const result = runGate(dir, fakeBin(dir))
      expect(result.status).toBe(0)
      expect(result.stdout).toMatch(/openFindingsCount/)
    } finally {
      cleanup()
    }
  })

  it('NEGATIVE: filing N findings without draining never improves the signal (anti-gaming)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      // baseline 2; spool now 5 (filed 3 more, drained none) → must regress, NOT pass
      setupProject(dir, 2, 5)
      const result = runGate(dir, fakeBin(dir))
      expect(result.status).toBe(1)
      expect(result.stdout).toMatch(/regressed/)
    } finally {
      cleanup()
    }
  })

  it('spool absent → openFindingsCount omitted → shows missing-tool, gate stays green', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const scriptsDir = join(dir, 'scripts')
      mkdirSync(scriptsDir, { recursive: true })
      writeFileSync(
        join(scriptsDir, 'debt-baseline.json'),
        JSON.stringify({
          version: 2,
          capturedAt: '2026-01-01T00:00:00Z',
          commit: 'fixture',
          archetype: 'library',
          metrics: {
            openFindingsCount: { value: 3, unit: 'count', direction: 'lower-is-better' },
          },
        }),
      )
      writeFileSync(
        join(dir, '.jscpd.json'),
        JSON.stringify({ path: ['src'], reporters: ['json'] }),
      )
      installJscpdShim(dir)
      // No .arbiter/findings dir at all → metric omitted → baseline row is "missing tool"
      const result = runGate(dir, fakeBin(dir))
      expect(result.status).toBe(0)
      expect(result.stdout).toMatch(/missing tool/)
    } finally {
      cleanup()
    }
  })
})
