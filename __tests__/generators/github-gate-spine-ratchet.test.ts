// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateGithub } from '../../src/generators/github.js'
import { makeConfig } from '../helpers.js'

// #2291 — the anti-erosion ratchet was delivered through the very channel it exists to
// police. Measured on the pinned consumers: after `arbiter update`, the manifest of both
// haben and coach-system carries `withheldSafety: ["scripts/check-all.mjs", ...]` and
// `node scripts/check-safety-adopt-ratchet.mjs` exits 1 with the debt in clear — so the
// gate is NOT dead. It simply never runs: it is registered only in `gate-registry.yml`,
// which lands in `scripts/check-all.mjs`, which is exactly the file being withheld
// (measured: 0 occurrences of the ratchet in either consumer's spine after update).
// The gate that detects a frozen spine cannot be delivered through the frozen spine.
//
// The fix is the delivery channel: workflows are arbiter-owned and never withheld
// (measured: 0 workflow entries in either consumer's withheldSafety), so the PR workflow
// invokes the ratchet as its own step, independent of the spine's own outcome.
describe('generateGithub — gate-spine erosion ratchet reaches a frozen consumer (#2291)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-spine-ratchet-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const prFast = () =>
    readFileSync(join(dir, '.github', 'workflows', '01-pr-fast.yml'), 'utf8')

  it('the PR workflow invokes the ratchet directly, not only through the gate spine', () => {
    generateGithub(makeConfig(dir, { governanceLevel: 'L2' }))
    expect(prFast()).toContain('node scripts/check-safety-adopt-ratchet.mjs')
  })

  it('the ratchet step is its own step, so a frozen spine cannot gate it', () => {
    generateGithub(makeConfig(dir, { governanceLevel: 'L2' }))
    const steps = prFast()
      .split(/^\s*- name: /m)
      .filter((step) => step.includes('node scripts/check-safety-adopt-ratchet.mjs'))
    expect(steps).toHaveLength(1)
    // If the ratchet shared a step with check-all.mjs it would inherit the withheld
    // spine's fate — the catch-22 reproduced one layer up.
    expect(steps[0]).not.toContain('scripts/check-all.mjs')
  })
})
