// SPDX-License-Identifier: Apache-2.0
// RED phase (#1410): when `arbiter update` emits a NEW check-*.mjs AND
// scripts/check-all.mjs is WITHHELD (user-modified), the new gate lands unwired —
// update must emit an explicit warning. Pure helper unit-tested directly.
import { describe, it, expect } from 'vitest'
import {
  detectUnwiredGateWarning,
  detectGateSignatureWarning,
  unwiredGuardKeys,
} from '../../src/commands/update.js'
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

  it('does NOT warn when an adopted gate spine landed despite its original withheld status (#2142)', () => {
    const results: WriteResult[] = [
      { path: '/p/scripts/check-foo.mjs', action: 'created' },
      {
        path: '/p/scripts/check-all.mjs',
        action: 'backed-up-and-replaced',
        withheld: true,
        adopted: true,
      },
    ]
    expect(detectUnwiredGateWarning(results)).toBeNull()
    expect(unwiredGuardKeys(results, '/p')).toEqual([])
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

describe('unwiredGuardKeys — honest manifest section (#1504/M1)', () => {
  it('returns targetDir-relative keys of newly-landed guards when check-all is withheld', () => {
    const results: WriteResult[] = [
      { path: '/p/scripts/check-anti-fake-green.mjs', action: 'created' },
      { path: '/p/scripts/check-min-test-execution.mjs', action: 'backed-up-and-replaced' },
      { path: '/p/scripts/check-all.mjs', action: 'skipped', withheld: true },
    ]
    expect(unwiredGuardKeys(results, '/p')).toEqual([
      'scripts/check-anti-fake-green.mjs',
      'scripts/check-min-test-execution.mjs',
    ])
  })

  it('returns the SAME set the warning lists (file and console cannot disagree)', () => {
    const results: WriteResult[] = [
      { path: '/p/scripts/check-foo.mjs', action: 'created' },
      { path: '/p/scripts/check-all.mjs', action: 'skipped', withheld: true },
    ]
    const keys = unwiredGuardKeys(results, '/p')
    const warning = detectUnwiredGateWarning(results) ?? ''
    expect(keys).toEqual(['scripts/check-foo.mjs'])
    // every recorded key's basename appears in the operator-facing warning
    for (const k of keys) expect(warning).toContain(k.slice(k.lastIndexOf('/') + 1))
  })

  it('is EMPTY when check-all is freshly re-synced (gap closed → no over-claim, no false flag)', () => {
    const results: WriteResult[] = [
      { path: '/p/scripts/check-foo.mjs', action: 'created' },
      { path: '/p/scripts/check-all.mjs', action: 'backed-up-and-replaced' },
    ]
    expect(unwiredGuardKeys(results, '/p')).toEqual([])
  })

  it('is EMPTY when no new guard landed (only check-all withheld)', () => {
    const results: WriteResult[] = [
      { path: '/p/scripts/check-all.mjs', action: 'skipped', withheld: true },
      { path: '/p/AGENTS.md', action: 'created' },
    ]
    expect(unwiredGuardKeys(results, '/p')).toEqual([])
  })
})

describe('detectGateSignatureWarning (#1504)', () => {
  it('warns when a gate-invoking workflow is (re)written AND check-all.mjs is withheld', () => {
    const results: WriteResult[] = [
      { path: '/p/.github/workflows/01-pr-fast.yml', action: 'backed-up-and-replaced' },
      { path: '/p/scripts/check-all.mjs', action: 'skipped', withheld: true },
    ]
    const warning = detectGateSignatureWarning(results)
    expect(warning).not.toBeNull()
    expect(warning).toContain('withheld')
    expect(warning).toContain('--json')
    expect(warning).toContain('fake-green')
  })

  it('fires for a freshly created nightly workflow too', () => {
    const results: WriteResult[] = [
      { path: '/p/.github/workflows/06-nightly.yml', action: 'created' },
      { path: '/p/scripts/check-all.mjs', action: 'skipped', withheld: true },
    ]
    expect(detectGateSignatureWarning(results)).not.toBeNull()
  })

  it('does NOT warn when check-all.mjs is freshly re-synced (not withheld)', () => {
    const results: WriteResult[] = [
      { path: '/p/.github/workflows/01-pr-fast.yml', action: 'backed-up-and-replaced' },
      { path: '/p/scripts/check-all.mjs', action: 'backed-up-and-replaced' },
    ]
    expect(detectGateSignatureWarning(results)).toBeNull()
  })

  it('does NOT warn when no gate-invoking workflow was written (only check-all withheld)', () => {
    const results: WriteResult[] = [
      { path: '/p/.github/workflows/15-codeql.yml', action: 'created' },
      { path: '/p/scripts/check-all.mjs', action: 'skipped', withheld: true },
    ]
    expect(detectGateSignatureWarning(results)).toBeNull()
  })

  it('does NOT warn when the workflow was skipped (unchanged), not (re)written', () => {
    const results: WriteResult[] = [
      { path: '/p/.github/workflows/01-pr-fast.yml', action: 'skipped' },
      { path: '/p/scripts/check-all.mjs', action: 'skipped', withheld: true },
    ]
    expect(detectGateSignatureWarning(results)).toBeNull()
  })
})
