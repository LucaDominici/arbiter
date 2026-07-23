// SPDX-License-Identifier: Apache-2.0
// __tests__/scripts/capacity-probe.test.ts
//
// #2098: combined local+remote saturation advisory. Pure verdict unit tests
// (direct import, no `gh`/`/proc` dependency) + a parity pin against
// gate-exec.ts's real gateLockPath (the mjs mirrors that derivation —
// tolerated duplication per #2098 scope, safety-netted by this test) + a
// real-execution smoke test (CANON-07).
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { computeVerdict, gateLockPathFor } from '../../scripts/capacity-probe.mjs'
import { deriveGateKey, gateLockPath } from '../../src/commands/gate-exec.js'

describe('computeVerdict (#2098) — SATURATED iff any of 3 signals fires', () => {
  const GREEN = {
    load1: 1,
    nproc: 8,
    gateQueueDepth: 0,
    runnersBusy: 1,
    runnersTotal: 3,
    queuedRuns: 0,
  }

  it('OK when nothing is saturated', () => {
    expect(computeVerdict(GREEN).saturated).toBe(false)
  })

  it('SATURATED when all runners are busy AND a run is queued', () => {
    expect(
      computeVerdict({ ...GREEN, runnersBusy: 3, runnersTotal: 3, queuedRuns: 1 }).saturated,
    ).toBe(true)
  })

  it('NOT saturated when all runners are busy but nothing is queued', () => {
    expect(
      computeVerdict({ ...GREEN, runnersBusy: 3, runnersTotal: 3, queuedRuns: 0 }).saturated,
    ).toBe(false)
  })

  it('SATURATED when load exceeds 1.5x nproc', () => {
    expect(computeVerdict({ ...GREEN, load1: 12.1, nproc: 8 }).saturated).toBe(true)
  })

  it('NOT saturated exactly at the 1.5x boundary', () => {
    expect(computeVerdict({ ...GREEN, load1: 12, nproc: 8 }).saturated).toBe(false)
  })

  it('SATURATED when gate-queue depth is >= 3', () => {
    expect(computeVerdict({ ...GREEN, gateQueueDepth: 3 }).saturated).toBe(true)
  })

  it('NOT saturated at gate-queue depth 2', () => {
    expect(computeVerdict({ ...GREEN, gateQueueDepth: 2 }).saturated).toBe(false)
  })

  it('zero runners (signal unavailable) never triggers remote saturation on its own', () => {
    expect(
      computeVerdict({ ...GREEN, runnersBusy: 0, runnersTotal: 0, queuedRuns: 5 }).saturated,
    ).toBe(false)
  })
})

describe('gateLockPathFor parity with gate-exec.ts (#2098 — safe duplication)', () => {
  it('derives the exact same lock path gate-exec.ts would use for this repo', () => {
    const xdg = mkdtempSync(join(tmpdir(), 'arbiter-parity-xdg-'))
    try {
      const dir = process.cwd()
      const env = { XDG_RUNTIME_DIR: xdg }
      const key = deriveGateKey(dir)
      const expected = gateLockPath(key, env)
      expect(gateLockPathFor(dir, env)).toBe(expected)
    } finally {
      rmSync(xdg, { recursive: true, force: true })
    }
  })
})

describe('capacity-probe.mjs real execution (#2098, CANON-07)', () => {
  it('prints one capacity-probe line and exits 0 or 1', () => {
    const r = spawnSync('node', ['scripts/capacity-probe.mjs', 'LucaDominici/arbiter'], {
      encoding: 'utf-8',
      timeout: 20_000,
    })
    expect([0, 1]).toContain(r.status)
    const lines = r.stdout.trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^capacity-probe: (OK|SATURATED)\b/)
  })
})
