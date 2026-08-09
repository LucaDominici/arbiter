// SPDX-License-Identifier: Apache-2.0
// #2222 — examples/ must never drift from what `arbiter init` generates today.
// Thin vitest wrapper around the same check the L2 gate runs
// (`node scripts/regenerate-examples.mjs --check`), so a real drift genuinely
// reds this test — not a synthetic fixture.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'

describe('#2222 — examples/ has no drift from arbiter init output', () => {
  it('regenerate-examples.mjs --check exits 0', () => {
    const r = spawnSync('node', ['scripts/regenerate-examples.mjs', '--check'], {
      encoding: 'utf-8',
    })
    expect(r.status).toBe(0)
  })
})
