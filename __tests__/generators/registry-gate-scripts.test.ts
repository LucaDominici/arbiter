// SPDX-License-Identifier: Apache-2.0
// #1319.1 — the generated gate invokes check-anti-proforma.mjs (unconditional) and
// check-commit-footer-rationale.mjs (L2+), but the registry never EMITTED either
// script — a virgin init self-gate fails with "Cannot find module". These tests
// pin the wiring: both generators are registered, with the same activation gating
// as the corresponding runCheck invocation in check-all.mjs.ejs.
import { describe, it, expect } from 'vitest'
import { buildRegistry } from '../../src/generators/registry.js'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

const find = (specs: ReturnType<typeof buildRegistry>, key: string) =>
  specs.find((s) => s.key === key)

describe('registry — anti-proforma generator wiring (#1319.1)', () => {
  it('anti-proforma spec is registered and enabled UNCONDITIONALLY at L2', () => {
    const specs = buildRegistry(makeConfig('/tmp', { governanceLevel: 'L2' }))
    expect(find(specs, 'anti-proforma')?.enabled).toBe(true)
  })

  it('anti-proforma spec is enabled even at L1 (mirrors unconditional runCheck)', () => {
    // check-all.mjs.ejs invokes scripts/check-anti-proforma.mjs OUTSIDE any
    // governanceLevel guard → it must be emitted at every level or the L1 gate
    // false-fails with a missing-module error. It is warn-default ⇒ greenfield-safe.
    const specs = buildRegistry(makeConfig('/tmp', { governanceLevel: 'L1' }))
    expect(find(specs, 'anti-proforma')?.enabled).toBe(true)
  })

  it('anti-proforma generator emits scripts/check-anti-proforma.mjs', () => {
    const specs = buildRegistry(makeConfig('/tmp/proj', { governanceLevel: 'L2' }))
    const files = find(specs, 'anti-proforma')?.run({ dryRun: true }) ?? []
    expect(files.some((f) => f.path.endsWith('scripts/check-anti-proforma.mjs'))).toBe(true)
  })
})

describe('registry — commit-footer-rationale generator wiring (#1319.1)', () => {
  it('commit-footer spec is registered and enabled at L2 (mirrors L1-guard)', () => {
    const specs = buildRegistry(makeConfig('/tmp', { governanceLevel: 'L2' }))
    expect(find(specs, 'commit-footer-rationale')?.enabled).toBe(true)
  })

  it('commit-footer spec is enabled at L3', () => {
    const specs = buildRegistry(makeConfig('/tmp', { governanceLevel: 'L3' }))
    expect(find(specs, 'commit-footer-rationale')?.enabled).toBe(true)
  })

  it('commit-footer spec is DISABLED at L1 (mirrors `governanceLevel !== L1` guard)', () => {
    // check-all.mjs.ejs:754 runs scripts/check-commit-footer-rationale.mjs only
    // inside `<% if (governanceLevel !== 'L1') %>` → emitting it at L1 would be
    // dead, and NOT emitting it at L2+ false-fails the gate. enabled must mirror.
    const specs = buildRegistry(makeConfig('/tmp', { governanceLevel: 'L1' }))
    expect(find(specs, 'commit-footer-rationale')?.enabled).toBe(false)
  })

  it('commit-footer generator emits scripts/check-commit-footer-rationale.mjs', () => {
    const specs = buildRegistry(makeConfig('/tmp/proj', { governanceLevel: 'L2' }))
    const files = find(specs, 'commit-footer-rationale')?.run({ dryRun: true }) ?? []
    expect(files.some((f) => f.path.endsWith('scripts/check-commit-footer-rationale.mjs'))).toBe(
      true,
    )
  })
})

describe('emitted check-commit-footer-rationale.mjs fails-OPEN on a no-upstream repo (#1319.1)', () => {
  // RT-amendment: on a virgin repo with no origin/main, `git log origin/main..HEAD`
  // fails → getCommitsInRange returns null → the script must exit 0 with a WARN/SKIP,
  // else virgin-init L2 false-fails. Assert the fail-open contract is present in the
  // rendered script source (no spawn needed — the predicate is the load-bearing text).
  const rendered = renderTemplate('scripts/check-commit-footer-rationale.mjs.ejs', {
    ...makeConfig('/tmp/proj', { governanceLevel: 'L2' }),
  } as unknown as Record<string, unknown>)

  it('returns null from getCommitsInRange when git log fails (no origin/main)', () => {
    // getCommitsInRange wraps the git log in try/catch and returns null on failure.
    expect(rendered).toMatch(/catch\s*\{\s*return null;?\s*\}/)
  })

  it('exits 0 (fail-open) and records a SKIP when commits === null', () => {
    expect(rendered).toContain('if (commits === null)')
    expect(rendered).toContain("result: 'SKIP'")
    // The fail-open branch ends in process.exit(0), NOT exit(1).
    const failOpenBlock = rendered.slice(
      rendered.indexOf('if (commits === null)'),
      rendered.indexOf('const violations'),
    )
    expect(failOpenBlock).toContain('process.exit(0)')
    expect(failOpenBlock).not.toContain('process.exit(1)')
  })
})
