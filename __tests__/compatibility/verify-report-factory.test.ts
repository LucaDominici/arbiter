// SPDX-License-Identifier: Apache-2.0
// makeVerifyReport derives the hasFailures/hasWarnings invariant at construction (#1533 item 2).
//
// hasFailures/hasWarnings used to be hand-set alongside `probes`, so a producer (or a later
// probes.push) could leave them out of sync with the array. The factory is the single place the
// two booleans are derived, and `probes` is readonly, so the invariant cannot silently drift.
import { describe, it, expect } from 'vitest'
import { makeVerifyReport } from '../../src/compatibility/schema.js'
import type { ProbeResult } from '../../src/compatibility/schema.js'

const passed: ProbeResult = {
  tool: 'node',
  status: 'passed',
  version: { major: 20, minor: 0, patch: 0 },
}
const failed: ProbeResult = { tool: 'mvn', status: 'failed', reason: 'too old' }
const warning: ProbeResult = {
  tool: 'hooksPath',
  status: 'warning',
  reason: 'core.hooksPath unset',
}
const skipped: ProbeResult = { tool: 'gradle', status: 'skipped', reason: 'toolchain-missing' }

describe('makeVerifyReport (#1533)', () => {
  it('derives hasFailures=false / hasWarnings=false from an all-passed probe set', () => {
    const r = makeVerifyReport('/app', 'typescript', [passed])
    expect(r.dir).toBe('/app')
    expect(r.stack).toBe('typescript')
    expect(r.probes).toEqual([passed])
    expect(r.hasFailures).toBe(false)
    expect(r.hasWarnings).toBe(false)
  })

  it('derives hasFailures=true when any probe failed', () => {
    const r = makeVerifyReport('/app', 'java', [passed, skipped, failed])
    expect(r.hasFailures).toBe(true)
    expect(r.hasWarnings).toBe(false)
  })

  it('derives hasWarnings=true when any probe warned', () => {
    const r = makeVerifyReport('/app', 'typescript', [passed, warning])
    expect(r.hasFailures).toBe(false)
    expect(r.hasWarnings).toBe(true)
  })

  it('the derived booleans always match the probe array (no drift surface)', () => {
    const probes = [passed, failed, warning, skipped]
    const r = makeVerifyReport('/app', 'go', probes)
    expect(r.hasFailures).toBe(probes.some((p) => p.status === 'failed'))
    expect(r.hasWarnings).toBe(probes.some((p) => p.status === 'warning'))
  })
})
