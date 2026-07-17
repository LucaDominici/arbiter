// SPDX-License-Identifier: Apache-2.0
//
// #1977: trunk-solo repos get the local-ci-parity check wired BY DEFAULT.
// A no-PR flow is only sound when `run.sh gate full ≡ CI`; without the parity
// check + push-gating there is no independent CI net before trunk. This test
// guards the generator side: generateCheckAll emits scripts/check-local-ci-parity.mjs
// for trunk-solo (and only trunk-solo — peer/gated review rely on the PR net instead),
// and check-all.mjs.ejs wires it at L2.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateCheckAll } from '../../src/generators/check-all.js'
import { makeConfig } from '../helpers.js'

describe('generateCheckAll — trunk-solo local-ci-parity default wiring (#1977)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-check-all-parity-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('emits scripts/check-local-ci-parity.mjs for collaborationMode=trunk-solo', () => {
    const result = generateCheckAll(makeConfig(dir, { collaborationMode: 'trunk-solo' }))
    expect(result.files.some((f) => f.path.endsWith('scripts/check-local-ci-parity.mjs'))).toBe(
      true,
    )
  })

  it('does NOT emit scripts/check-local-ci-parity.mjs for peer-review (PR is the net)', () => {
    const result = generateCheckAll(makeConfig(dir, { collaborationMode: 'peer-review' }))
    expect(result.files.some((f) => f.path.endsWith('scripts/check-local-ci-parity.mjs'))).toBe(
      false,
    )
  })

  it('does NOT emit scripts/check-local-ci-parity.mjs for gated-review (PR is the net)', () => {
    const result = generateCheckAll(makeConfig(dir, { collaborationMode: 'gated-review' }))
    expect(result.files.some((f) => f.path.endsWith('scripts/check-local-ci-parity.mjs'))).toBe(
      false,
    )
  })

  it('check-all.mjs.ejs wires check-local-ci-parity.mjs at L2 for trunk-solo', () => {
    generateCheckAll(makeConfig(dir, { collaborationMode: 'trunk-solo', governanceLevel: 'L2' }))
    const content = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf8')
    expect(content).toMatch(/check-local-ci-parity\.mjs/)
  })
})
