// SPDX-License-Identifier: Apache-2.0
// #2431: the cross-model fixtures' wall-clock budgets must be DERIVED from the vitest pool
// size, never pinned to a literal chosen on an idle host. These are the derivation rules;
// the fixtures themselves consume them (AC-1).
import { describe, expect, it } from 'vitest'
import { availableParallelism } from 'node:os'
import { ciMaxWorkers } from '../../vitest.config'
import {
  externalSeatHarnessTimeoutMs,
  externalSeatTimeoutMs,
} from './external-seat-budget.js'

// vitest sizes its default pool at `availableParallelism() - 1`, so a `parallelism` of 2
// stands for a one-worker pool and 9 for an eight-worker pool.
const SOLO_POOL = { env: {}, parallelism: 2 } as const
const EIGHT_WORKER_POOL = { env: {}, parallelism: 9 } as const

describe('external-seat wall-clock budget (#2431)', () => {
  it('reproduces the vitest testTimeout ceiling on a one-worker pool (AC-1)', () => {
    // The floor is today's harness ceiling (vitest.config testTimeout): an uncontended
    // pool must not get a wider budget than it has now.
    expect(externalSeatHarnessTimeoutMs(SOLO_POOL)).toBe(30_000)
  })

  it('scales the harness ceiling with the vitest pool size (AC-1)', () => {
    expect(externalSeatHarnessTimeoutMs(EIGHT_WORKER_POOL)).toBe(240_000)
  })

  it('scales the seat budget with the vitest pool size (AC-1)', () => {
    expect(externalSeatTimeoutMs(EIGHT_WORKER_POOL)).toBeGreaterThan(
      externalSeatTimeoutMs(SOLO_POOL),
    )
  })

  it('keeps the seat budget strictly inside its own harness ceiling (AC-1)', () => {
    // The seat spawns two sequential children (codex, then the recorder) inside one
    // harness window, so a seat budget at or above the ceiling could never be reached:
    // the harness would kill the run first and the scaling would be inert.
    for (const pool of [SOLO_POOL, EIGHT_WORKER_POOL]) {
      expect(externalSeatTimeoutMs(pool) * 2).toBeLessThan(externalSeatHarnessTimeoutMs(pool))
    }
  })

  it('never drops below the 5 s budget the fixtures used before (AC-1)', () => {
    expect(externalSeatTimeoutMs(SOLO_POOL)).toBeGreaterThanOrEqual(5_000)
  })

  it('prefers an explicit VITEST_MAX_WORKERS over host parallelism (AC-1)', () => {
    expect(
      externalSeatHarnessTimeoutMs({ env: { VITEST_MAX_WORKERS: '6' }, parallelism: 64 }),
    ).toBe(180_000)
  })

  it('reads a percentage VITEST_MAX_WORKERS against host parallelism (AC-1)', () => {
    expect(
      externalSeatHarnessTimeoutMs({ env: { VITEST_MAX_WORKERS: '50%' }, parallelism: 8 }),
    ).toBe(120_000)
  })

  it('derives the CI pool from ciMaxWorkers (AC-1)', () => {
    const env = { CI: 'true' }
    const workers = ciMaxWorkers(env)
    expect(workers).toBeDefined()
    expect(externalSeatHarnessTimeoutMs({ env, parallelism: 64 })).toBe(30_000 * (workers ?? 0))
  })

  it('clamps the harness ceiling so a hung seat cannot stall the suite (AC-1)', () => {
    expect(externalSeatHarnessTimeoutMs({ env: {}, parallelism: 200 })).toBe(240_000)
  })

  it('honours a caller-supplied base so a fixture can prove the scaling cheaply (AC-1)', () => {
    expect(externalSeatHarnessTimeoutMs({ ...SOLO_POOL, baseMs: 3_000 })).toBe(3_000)
    expect(externalSeatHarnessTimeoutMs({ ...EIGHT_WORKER_POOL, baseMs: 3_000 })).toBe(24_000)
  })

  it('defaults to this host without any caller argument (AC-1)', () => {
    // Whatever this host is, the no-argument form must equal the explicit form and stay
    // inside the documented band — the fixtures call it with no arguments.
    const actual = externalSeatHarnessTimeoutMs()
    expect(actual).toBe(
      externalSeatHarnessTimeoutMs({ env: process.env, parallelism: availableParallelism() }),
    )
    expect(actual).toBeGreaterThanOrEqual(30_000)
    expect(actual).toBeLessThanOrEqual(240_000)
  })
})
