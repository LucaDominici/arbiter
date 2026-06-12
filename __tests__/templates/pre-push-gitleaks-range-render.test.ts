// SPDX-License-Identifier: Apache-2.0
// #1319.9 — the generated pre-push hook must scope gitleaks to the PUSH RANGE
// (origin/<base>..HEAD / @{u}..HEAD) via `--log-opts`, not a full-tree `detect`.
// A full-tree scan on every push re-flags the entire history and is O(repo); the
// pre-push gate only needs to vet the commits actually being pushed.
// Track-B-only: arbiter's own .githooks/pre-push has no gitleaks (it runs in
// pre-commit + check-all full-tree), so this is asserted on the RENDERED template.
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function render(overrides: Record<string, unknown> = {}): string {
  return renderTemplate('githooks/pre-push.ejs', {
    ...makeConfig('/tmp/proj', { language: 'typescript', enableSecurityScanning: true }),
    ...overrides,
  } as unknown as Record<string, unknown>)
}

describe('generated pre-push gitleaks is scoped to the push range (#1319.9)', () => {
  it('invokes gitleaks with --log-opts scoped to a commit range, not a full-tree detect', () => {
    const out = render()
    expect(out).toContain('gitleaks')
    expect(out).toContain('--log-opts')
  })

  it('the gitleaks range derives from the upstream / origin base (@{u}..HEAD or origin/<base>..HEAD)', () => {
    const out = render()
    // Push-range token: either @{u}..HEAD (tracked upstream) or origin/<base>..HEAD.
    expect(out).toMatch(/@\{u\}\.\.HEAD|origin\/[^.\s]+\.\.HEAD/)
  })

  it('uses `gitleaks detect --log-opts`, NOT a bare `gitleaks detect --source .` full-tree scan', () => {
    const out = render()
    // Guard against regressing to the full-tree form.
    expect(out).not.toMatch(/gitleaks\s+detect\s+--source\s+\.(?!.*--log-opts)/)
  })

  it('gitleaks block is gated on enableSecurityScanning (absent when scanning disabled)', () => {
    const out = render({ enableSecurityScanning: false })
    expect(out).not.toContain('gitleaks')
  })
})
