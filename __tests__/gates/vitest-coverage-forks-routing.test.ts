// SPDX-License-Identifier: Apache-2.0
// #2516: `poolMatchGlobs` was removed in Vitest 3+. This repo runs Vitest 4.1.11,
// where the key is not a recognized option — vitest silently ignores it instead
// of rejecting it, so `__tests__/coverage/**` lost the process-level isolation
// (heavy vi.doMock + process.exit/stdout stubs + real subprocess spawns) that
// the option's own comment said it needed. Vitest 3+ replaces per-glob pool
// selection with `test.projects`; this asserts the dead key is gone and the
// coverage suite is actually routed to the `forks` pool through a project.
import { describe, it, expect } from 'vitest'
import config from '../../vitest.config'

type ProjectEntry = { test?: { include?: string[]; pool?: string } }

function projects(): ProjectEntry[] {
  const test = (config as { test?: { projects?: ProjectEntry[] } }).test
  return test?.projects ?? []
}

describe('vitest coverage pool routing (#2516)', () => {
  it('does not carry the dead poolMatchGlobs option (removed in Vitest 3+)', () => {
    expect(config.test).not.toHaveProperty('poolMatchGlobs')
  })

  it('routes __tests__/coverage/** to the forks pool through a project', () => {
    const coverageProject = projects().find((p) =>
      (p.test?.include ?? []).some((pattern) => pattern.includes('__tests__/coverage/')),
    )
    expect(coverageProject).toBeDefined()
    expect(coverageProject?.test?.pool).toBe('forks')
  })
})
