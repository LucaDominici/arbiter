// SPDX-License-Identifier: Apache-2.0
// RED phase (#1410): when `arbiter update` emits a NEW check-*.mjs AND
// scripts/check-all.mjs is WITHHELD (user-modified), the new gate lands unwired —
// update must emit an explicit warning. Pure helper unit-tested directly.
import { describe, it, expect } from 'vitest'
import { detectUnwiredGateWarning } from '../../src/commands/update.js'
import type { WriteResult } from '../../src/utils/fs.js'

describe('detectUnwiredGateWarning (#1410)', () => {
  it('warns when a NEW check-*.mjs is emitted AND check-all.mjs is withheld', () => {
    const results: WriteResult[] = [
      { path: '/p/scripts/check-foo.mjs', action: 'created' },
      { path: '/p/scripts/check-all.mjs', action: 'skipped', withheld: true },
    ]
    const warning = detectUnwiredGateWarning(results)
    expect(warning).not.toBeNull()
    expect(warning).toContain('check-foo.mjs')
    expect(warning).toContain('check-all.mjs is withheld')
    expect(warning).toContain('NOT wired')
  })

  it('lists every newly emitted check script when multiple land unwired', () => {
    const results: WriteResult[] = [
      { path: '/p/scripts/check-foo.mjs', action: 'created' },
      { path: '/p/scripts/check-bar.mjs', action: 'backed-up-and-replaced' },
      { path: '/p/scripts/check-all.mjs', action: 'skipped', withheld: true },
    ]
    const warning = detectUnwiredGateWarning(results)
    expect(warning).toContain('check-foo.mjs')
    expect(warning).toContain('check-bar.mjs')
  })

  it('does NOT warn when check-all.mjs is freshly written (re-synced, not withheld)', () => {
    const results: WriteResult[] = [
      { path: '/p/scripts/check-foo.mjs', action: 'created' },
      { path: '/p/scripts/check-all.mjs', action: 'backed-up-and-replaced' },
    ]
    expect(detectUnwiredGateWarning(results)).toBeNull()
  })

  it('does NOT warn when no new check-*.mjs was emitted (only check-all withheld)', () => {
    const results: WriteResult[] = [
      { path: '/p/scripts/check-all.mjs', action: 'skipped', withheld: true },
      { path: '/p/AGENTS.md', action: 'created' },
    ]
    expect(detectUnwiredGateWarning(results)).toBeNull()
  })

  it('does NOT warn for a skipped (unchanged, not withheld) check script', () => {
    const results: WriteResult[] = [
      { path: '/p/scripts/check-foo.mjs', action: 'skipped' },
      { path: '/p/scripts/check-all.mjs', action: 'skipped', withheld: true },
    ]
    expect(detectUnwiredGateWarning(results)).toBeNull()
  })

  it('does NOT mistake a non-check script (e.g. conformance.mjs) for a gate', () => {
    const results: WriteResult[] = [
      { path: '/p/scripts/conformance.mjs', action: 'created' },
      { path: '/p/scripts/check-all.mjs', action: 'skipped', withheld: true },
    ]
    expect(detectUnwiredGateWarning(results)).toBeNull()
  })

  it('suggests re-syncing check-all to activate', () => {
    const results: WriteResult[] = [
      { path: '/p/scripts/check-foo.mjs', action: 'created' },
      { path: '/p/scripts/check-all.mjs', action: 'skipped', withheld: true },
    ]
    const warning = detectUnwiredGateWarning(results) ?? ''
    expect(warning).toContain('re-sync')
  })
})
