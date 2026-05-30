// SPDX-License-Identifier: Apache-2.0
// TDD red phase: supply-chain template render tests (CANON-04, CANON-18, #885)
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function renderRetrySign(overrides: Record<string, unknown> = {}) {
  return renderTemplate(
    'github/workflows/_sigstore-retry-sign.yml.ejs',
    makeConfig('/tmp/test', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
      string,
      unknown
    >,
  )
}

// ─── CANON-18: _sigstore-retry-sign.yml.ejs structural invariants ─────────────

describe('_sigstore-retry-sign.yml.ejs — structural invariants (CANON-18, #885)', () => {
  const STACKS = [
    { language: 'typescript', buildTool: 'npm' },
    { language: 'java', buildTool: 'gradle' },
    { language: 'go', buildTool: 'go' },
    { language: 'python', buildTool: 'pip' },
    { language: 'rust', buildTool: 'cargo' },
  ] as const

  const LEVELS = ['L1', 'L2', 'L3'] as const

  it.each(STACKS)('$language: workflow name present', ({ language, buildTool }) => {
    const rendered = renderRetrySign({ language, buildTool })
    expect(rendered).toContain('name:')
  })

  it.each(STACKS)('$language: workflow_call trigger present', ({ language, buildTool }) => {
    const rendered = renderRetrySign({ language, buildTool })
    expect(rendered).toContain('workflow_call')
  })

  it.each(STACKS)('$language: cosign sign-blob step present', ({ language, buildTool }) => {
    const rendered = renderRetrySign({ language, buildTool })
    expect(rendered).toContain('cosign')
    expect(rendered).toContain('sign-blob')
  })

  it.each(STACKS)(
    '$language: sigstore/cosign-installer action present',
    ({ language, buildTool }) => {
      const rendered = renderRetrySign({ language, buildTool })
      expect(rendered).toContain('sigstore/cosign-installer')
    },
  )

  it.each(STACKS)('$language: retry logic present (max-attempts)', ({ language, buildTool }) => {
    const rendered = renderRetrySign({ language, buildTool })
    // retry wrapper must have retry mechanism
    expect(rendered).toMatch(/retry|max.attempts|attempt/i)
  })

  it.each(LEVELS)('%s: renders without error', (governanceLevel) => {
    const rendered = renderRetrySign({ governanceLevel })
    expect(rendered.length).toBeGreaterThan(100)
  })
})

// ─── CANON-19: sign-and-attest/action.yml.ejs SBOM attestation ─────────────────

describe('sign-and-attest/action.yml.ejs — SBOM attestation step (CANON-19, #885)', () => {
  function renderSignAndAttest(overrides: Record<string, unknown> = {}) {
    return renderTemplate(
      'github/actions/sign-and-attest/action.yml.ejs',
      makeConfig('/tmp/test', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
        string,
        unknown
      >,
    )
  }

  it('cosign sign-blob step present', () => {
    const rendered = renderSignAndAttest()
    expect(rendered).toContain('cosign sign-blob')
  })

  it('attest-build-provenance step present', () => {
    const rendered = renderSignAndAttest()
    expect(rendered).toContain('attest-build-provenance')
  })

  it('SBOM attestation step present via cosign attest or sbom-input', () => {
    const rendered = renderSignAndAttest()
    // Either cosign attest --predicate or an sbom-path input wired to attester
    expect(rendered).toMatch(/sbom|attest.*predicate|predicate.*sbom/i)
  })

  it('L4: verify-blob step present', () => {
    const rendered = renderSignAndAttest({ governanceLevel: 'L4' })
    expect(rendered).toContain('verify-blob')
  })

  it('L3: verify-blob step present (INV-101: non-L1 levels verify signature)', () => {
    const rendered = renderSignAndAttest({ governanceLevel: 'L3' })
    expect(rendered).toContain('verify-blob')
  })

  it('L2: verify-blob step present (INV-101: non-L1 levels verify signature)', () => {
    const rendered = renderSignAndAttest({ governanceLevel: 'L2' })
    expect(rendered).toContain('verify-blob')
  })

  it('L1: no verify-blob step (L1 stays lightweight)', () => {
    const rendered = renderSignAndAttest({ governanceLevel: 'L1' })
    expect(rendered).not.toContain('verify-blob')
  })
})
