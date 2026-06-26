// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function renderDeployTest(overrides: Record<string, unknown> = {}) {
  return renderTemplate(
    'github/workflows/04-deploy-test.yml.ejs',
    makeConfig('/tmp/test', overrides as Parameters<typeof makeConfig>[1]) as unknown as Record<
      string,
      unknown
    >,
  )
}

// ─── CANON-18: structural invariants (5 stacks × 3 governance levels) ────────

describe('04-deploy-test.yml.ejs — structural invariants (CANON-18)', () => {
  const STACKS = [
    { language: 'typescript', buildTool: 'npm' },
    { language: 'java', buildTool: 'maven' },
    { language: 'go', buildTool: 'go' },
    { language: 'python', buildTool: 'pip' },
    { language: 'rust', buildTool: 'cargo' },
  ] as const

  const LEVELS = ['L1', 'L2', 'L3'] as const

  it.each(STACKS)('$language: workflow name is "Deploy Test"', ({ language, buildTool }) => {
    const rendered = renderDeployTest({ language, buildTool })
    expect(rendered).toContain('name: Deploy Test')
  })

  it.each(STACKS)('$language: triggers on push to develop branch', ({ language, buildTool }) => {
    const rendered = renderDeployTest({ language, buildTool })
    expect(rendered).toContain('push:')
    expect(rendered).toContain('develop')
  })

  it.each(STACKS)('$language: id-token: write permission present', ({ language, buildTool }) => {
    const rendered = renderDeployTest({ language, buildTool })
    expect(rendered).toContain('id-token: write')
  })

  it.each(STACKS)('$language: concurrency cancel-in-progress false', ({ language, buildTool }) => {
    const rendered = renderDeployTest({ language, buildTool })
    expect(rendered).toContain('cancel-in-progress: false')
  })

  it.each(STACKS)(
    '$language: build-and-sign job present with Trivy scan',
    ({ language, buildTool }) => {
      const rendered = renderDeployTest({ language, buildTool })
      expect(rendered).toContain('build-and-sign:')
      expect(rendered).toContain('Trivy')
    },
  )

  it.each(STACKS)('$language: deploy-test job present', ({ language, buildTool }) => {
    const rendered = renderDeployTest({ language, buildTool })
    expect(rendered).toContain('deploy-test:')
  })

  it.each(STACKS)('$language: post-deploy-smoke job present', ({ language, buildTool }) => {
    const rendered = renderDeployTest({ language, buildTool })
    expect(rendered).toContain('post-deploy-smoke:')
  })

  it.each(STACKS)('$language: notify job on failure', ({ language, buildTool }) => {
    const rendered = renderDeployTest({ language, buildTool })
    expect(rendered).toContain('notify:')
    expect(rendered).toContain('if: failure()')
  })

  it.each(LEVELS)('governance %s: no EJS tag leaks', (level) => {
    const rendered = renderDeployTest({ governanceLevel: level })
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })

  it.each(LEVELS)('governance %s: workflow name present', (level) => {
    const rendered = renderDeployTest({ governanceLevel: level })
    expect(rendered).toContain('name: Deploy Test')
  })
})

// ─── Security invariants ──────────────────────────────────────────────────────

describe('04-deploy-test.yml.ejs — security invariants', () => {
  it('Trivy blocks on HIGH/CRITICAL (security invariant before push)', () => {
    const rendered = renderDeployTest({ language: 'java', buildTool: 'maven' })
    expect(rendered).toContain("exit-code: '1'")
    expect(rendered).toContain("severity: 'HIGH,CRITICAL'")
  })

  it('cosign signing present (keyless OIDC)', () => {
    const rendered = renderDeployTest({ language: 'java', buildTool: 'maven' })
    expect(rendered).toContain('cosign sign')
  })

  it('cosign attest SBOM present', () => {
    const rendered = renderDeployTest({ language: 'java', buildTool: 'maven' })
    expect(rendered).toContain('cosign attest')
  })

  it('Sigstore preflight check present (H3-S1)', () => {
    const rendered = renderDeployTest({ language: 'java', buildTool: 'maven' })
    expect(rendered).toContain('sigstore')
  })

  it('ACR idempotent retry tag present (H2-M3)', () => {
    const rendered = renderDeployTest({ language: 'java', buildTool: 'maven' })
    expect(rendered).toContain('run_attempt')
  })
})

// ─── Per-language SBOM generation ────────────────────────────────────────────

describe('04-deploy-test.yml.ejs — per-language SBOM generation', () => {
  it('Java Maven: mvn cyclonedx:makeAggregateBom for SBOM', () => {
    const rendered = renderDeployTest({ language: 'java', buildTool: 'maven' })
    expect(rendered).toContain('cyclonedx:makeAggregateBom')
  })

  it('TypeScript: anchore/sbom-action for SBOM generation', () => {
    const rendered = renderDeployTest({ language: 'typescript', buildTool: 'npm' })
    expect(rendered).toContain('anchore/sbom-action')
    expect(rendered).not.toContain('cyclonedx:makeAggregateBom')
  })

  it('Go: anchore/sbom-action for SBOM generation', () => {
    const rendered = renderDeployTest({ language: 'go', buildTool: 'go' })
    expect(rendered).toContain('anchore/sbom-action')
  })

  it('Python: anchore/sbom-action for SBOM generation', () => {
    const rendered = renderDeployTest({ language: 'python', buildTool: 'pip' })
    expect(rendered).toContain('anchore/sbom-action')
  })

  it('Rust: anchore/sbom-action for SBOM generation', () => {
    const rendered = renderDeployTest({ language: 'rust', buildTool: 'cargo' })
    expect(rendered).toContain('anchore/sbom-action')
  })
})

// ─── Smoke test ───────────────────────────────────────────────────────────────

describe('04-deploy-test.yml.ejs — smoke test', () => {
  it('k6 smoke present in post-deploy-smoke job', () => {
    const rendered = renderDeployTest({})
    expect(rendered).toContain('k6 run')
  })

  it('k6 gracefully skips when BASE_URL not set', () => {
    const rendered = renderDeployTest({})
    expect(rendered).toContain('BASE_URL')
    expect(rendered).toContain('skip')
  })
})

// ─── DAST baseline (E4 #1502 — moved off the PR path to the ephemeral env) ─────

describe('04-deploy-test.yml.ejs — DAST baseline', () => {
  it('dast-baseline job present and runs after deploy-test', () => {
    const rendered = renderDeployTest({})
    expect(rendered).toContain('dast-baseline:')
    const dast = rendered.split('dast-baseline:')[1] ?? ''
    expect(dast).toContain('needs: [deploy-test]')
  })

  it('dast-baseline runs OWASP ZAP baseline against the TEST env URL', () => {
    const rendered = renderDeployTest({})
    expect(rendered).toContain('zaproxy/action-baseline')
    expect(rendered).toContain('${{ secrets.TEST_BASE_URL }}')
  })

  it('dast-baseline skips gracefully when TEST_BASE_URL is unset (SKIP_DAST_BASELINE)', () => {
    const rendered = renderDeployTest({})
    expect(rendered).toContain('SKIP_DAST_BASELINE')
  })

  it('dast-baseline is wired into the notify-on-failure needs', () => {
    const rendered = renderDeployTest({})
    const notify = rendered.split('notify:')[1] ?? ''
    expect(notify).toContain('dast-baseline')
  })
})
