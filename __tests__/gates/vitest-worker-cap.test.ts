// SPDX-License-Identifier: Apache-2.0
// #2282: the suite must not size its worker pool from the HOST's core count in CI.
//
// vitest sizes the fork pool at `availableParallelism() - 1` (vitest 4:
// getDefaultThreadsCount in cli-api). The self-hosted runner containers carry no
// CPU limit, so availableParallelism() reports the 24-core HOST and every CI job
// alone spawns ~23 forks. With up to four heavy slots plus local gates on one box
// that is ~90 forks over 24 cores; tests that spawn their own subprocesses starve
// and blow the wall-clock testTimeout. Which test loses the race is scheduler
// dependent, which is why the failing test differed per job on an identical SHA
// with zero assertion failures.
//
// Both configs must carry the cap: scripts/check-all.mjs runs the integration
// suite (INV-25) through vitest.integration.config.ts inside the same L2 gate.
import { describe, it, expect, vi } from 'vitest'
import { availableParallelism } from 'node:os'
import unitConfig from '../../vitest.config'
import integrationConfig from '../../vitest.integration.config'
import { ciMaxWorkers } from '../../vitest.config'

/** Re-evaluate a config module under a controlled CI env. */
async function maxWorkersUnder(
  ci: string | undefined,
  load: () => Promise<{ default: { test?: { maxWorkers?: number | string } } }>,
): Promise<number | string | undefined> {
  const previous = process.env.CI
  if (ci === undefined) delete process.env.CI
  else process.env.CI = ci
  vi.resetModules()
  try {
    return (await load()).default.test?.maxWorkers
  } finally {
    if (previous === undefined) delete process.env.CI
    else process.env.CI = previous
    vi.resetModules()
  }
}

describe('vitest worker cap (#2282)', () => {
  it('bounds the pool under CI instead of inheriting the host core count', () => {
    const capped = ciMaxWorkers({ CI: 'true' } as NodeJS.ProcessEnv)
    expect(capped).toBeGreaterThanOrEqual(1)
    expect(capped).toBeLessThanOrEqual(4)
    // The whole point: independent of how many cores the box happens to have.
    expect(capped).toBeLessThan(availableParallelism())
  })

  it('leaves local runs on the vitest default', () => {
    expect(ciMaxWorkers({} as NodeJS.ProcessEnv)).toBeUndefined()
  })

  it('wires the cap into the unit suite', async () => {
    expect(await maxWorkersUnder('true', () => import('../../vitest.config'))).toBe(
      ciMaxWorkers({ CI: 'true' } as NodeJS.ProcessEnv),
    )
    expect(await maxWorkersUnder(undefined, () => import('../../vitest.config'))).toBeUndefined()
  })

  it('wires the cap into the integration suite the L2 gate also runs', async () => {
    expect(await maxWorkersUnder('true', () => import('../../vitest.integration.config'))).toBe(
      ciMaxWorkers({ CI: 'true' } as NodeJS.ProcessEnv),
    )
  })

  it('keeps both suites on the same budget', () => {
    expect(unitConfig.test?.maxWorkers).toBe(integrationConfig.test?.maxWorkers)
  })
})
