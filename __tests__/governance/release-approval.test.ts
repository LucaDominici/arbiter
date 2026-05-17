// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const RELEASE_WORKFLOW = resolve(__dirname, '..', '..', '.github', 'workflows', 'release.yml')

// @RACI:R001 — Release approval. The arbiter release workflow must be
// dispatchable only by a maintainer (workflow_dispatch gated) and must
// concurrency-lock so two simultaneous publishes cannot race. This is the
// machine-checkable contract behind the Accountable=Maintainer assignment in
// docs/GOVERNANCE/RACI.md row R001.
describe('release workflow approval gates (@RACI:R001)', () => {
  const yaml = existsSync(RELEASE_WORKFLOW) ? readFileSync(RELEASE_WORKFLOW, 'utf-8') : ''

  it('release.yml exists', () => {
    expect(existsSync(RELEASE_WORKFLOW)).toBe(true)
  })

  it('declares workflow_dispatch trigger (maintainer-initiated)', () => {
    expect(yaml).toMatch(/workflow_dispatch/)
  })

  it('declares a concurrency group so two publishes cannot race', () => {
    expect(yaml).toMatch(/^concurrency:/m)
    expect(yaml).toMatch(/group:\s*release/)
  })

  it('does not grant id-token write at top level', () => {
    const topPerms = /^permissions:\n((?: {2}.*\n)+)/m.exec(yaml)?.[1] ?? ''
    expect(topPerms).not.toMatch(/id-token:\s*write/)
  })
})
