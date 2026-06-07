// SPDX-License-Identifier: Apache-2.0
/**
 * Template render tests — solo-exception EJS templates (#1250)
 * Validates no EJS tag leaks and key content per governance level.
 * CANON-04: snapshot tests for any .ejs templates touched.
 */
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function renderSoloException(template: string, overrides: Record<string, unknown> = {}) {
  return renderTemplate(
    template,
    makeConfig('/tmp/test', {
      collaborationMode: 'trunk-solo',
      governanceLevel: 'L3',
      projectName: 'test-project',
      ...overrides,
    } as Parameters<typeof makeConfig>[1]) as unknown as Record<string, unknown>,
  )
}

// ─── SOLO_DEV_EXCEPTION.md.ejs ────────────────────────────────────────────────

describe('governance/solo-dev-exception.md.ejs', () => {
  it('renders without EJS tag leaks', () => {
    const rendered = renderSoloException('governance/solo-dev-exception.md.ejs')
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })

  it('contains §11.10(k) reference', () => {
    const rendered = renderSoloException('governance/solo-dev-exception.md.ejs')
    expect(rendered).toContain('11.10')
  })

  it('contains project name', () => {
    const rendered = renderSoloException('governance/solo-dev-exception.md.ejs', {
      projectName: 'my-regulated-project',
    })
    expect(rendered).toContain('my-regulated-project')
  })

  it('contains reactivation trigger section', () => {
    const rendered = renderSoloException('governance/solo-dev-exception.md.ejs')
    expect(rendered).toMatch(/reactivation|active author/i)
  })

  it('contains governance level L3', () => {
    const rendered = renderSoloException('governance/solo-dev-exception.md.ejs', {
      governanceLevel: 'L3',
    })
    expect(rendered).toContain('L3')
  })

  it('renders for L4 without EJS leaks', () => {
    const rendered = renderSoloException('governance/solo-dev-exception.md.ejs', {
      governanceLevel: 'L4',
    })
    expect(rendered).not.toContain('<%')
    expect(rendered).toContain('L4')
  })
})

// ─── VALIDATION_EVIDENCE_TEMPLATE.md.ejs ─────────────────────────────────────

describe('governance/validation-evidence.md.ejs', () => {
  it('renders without EJS tag leaks', () => {
    const rendered = renderSoloException('governance/validation-evidence.md.ejs')
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })

  it('contains signed evidence section', () => {
    const rendered = renderSoloException('governance/validation-evidence.md.ejs')
    expect(rendered).toMatch(/sign|cosign|GPG/i)
  })

  it('contains metrics section', () => {
    const rendered = renderSoloException('governance/validation-evidence.md.ejs')
    expect(rendered).toMatch(/coverage|metrics|test/i)
  })

  it('contains retention policy reference', () => {
    const rendered = renderSoloException('governance/validation-evidence.md.ejs')
    expect(rendered).toMatch(/retention|EVIDENCE_RETENTION/i)
  })

  it('renders for L4 without EJS leaks', () => {
    const rendered = renderSoloException('governance/validation-evidence.md.ejs', {
      governanceLevel: 'L4',
    })
    expect(rendered).not.toContain('<%')
  })
})

// ─── CI_MENTAL_MODEL.md.ejs ───────────────────────────────────────────────────

describe('governance/ci-mental-model.md.ejs', () => {
  const LEVELS = ['L1', 'L2', 'L3', 'L4'] as const

  it.each(LEVELS)('renders without EJS tag leaks for %s', (level) => {
    const rendered = renderSoloException('governance/ci-mental-model.md.ejs', {
      governanceLevel: level,
    })
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })

  it('mentions pipeline stages (local/pre-commit, PR-fast, PR-extended, release, nightly)', () => {
    const rendered = renderSoloException('governance/ci-mental-model.md.ejs', {
      governanceLevel: 'L3',
    })
    // At least local and nightly stages should appear
    expect(rendered).toMatch(/local|pre.commit|T0/i)
    expect(rendered).toMatch(/nightly|T4/i)
  })

  it('L3+trunk-solo: mentions reactivation check in nightly stage', () => {
    const rendered = renderSoloException('governance/ci-mental-model.md.ejs', {
      governanceLevel: 'L3',
      collaborationMode: 'trunk-solo',
    })
    expect(rendered).toMatch(/reactivation|solo.reactivation/i)
  })

  it('contains project governance level', () => {
    const rendered = renderSoloException('governance/ci-mental-model.md.ejs', {
      governanceLevel: 'L3',
    })
    expect(rendered).toContain('L3')
  })
})

// ─── check-solo-reactivation.mjs.ejs ─────────────────────────────────────────

describe('scripts/check-solo-reactivation.mjs.ejs', () => {
  it('renders without EJS tag leaks', () => {
    const rendered = renderSoloException('scripts/check-solo-reactivation.mjs.ejs')
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })

  it('contains git log author-count logic', () => {
    const rendered = renderSoloException('scripts/check-solo-reactivation.mjs.ejs')
    expect(rendered).toMatch(/git log|--format.*%ae/i)
  })

  it('contains EXTERNAL_AUDIT env var check', () => {
    const rendered = renderSoloException('scripts/check-solo-reactivation.mjs.ejs')
    expect(rendered).toContain('EXTERNAL_AUDIT')
  })

  it('exits with non-zero on trigger (reactivation triggered message)', () => {
    const rendered = renderSoloException('scripts/check-solo-reactivation.mjs.ejs')
    expect(rendered).toMatch(/exit.*1|process\.exit\(1\)/i)
  })

  it('renders shebang for node', () => {
    const rendered = renderSoloException('scripts/check-solo-reactivation.mjs.ejs')
    expect(rendered).toMatch(/^#!.*node/m)
  })
})

// ─── 06-nightly-lite.yml.ejs: solo reactivation step ────────────────────────

describe('06-nightly-lite.yml.ejs — solo reactivation step (CANON-18)', () => {
  it('trunk-solo+L3: includes solo-reactivation-check step', () => {
    const rendered = renderTemplate(
      'github/workflows/06-nightly-lite.yml.ejs',
      makeConfig('/tmp/test', {
        collaborationMode: 'trunk-solo',
        governanceLevel: 'L3',
      }) as unknown as Record<string, unknown>,
    )
    expect(rendered).toMatch(/solo.reactivation|check-solo-reactivation/i)
  })

  it('trunk-solo+L2: does NOT include solo-reactivation-check step', () => {
    const rendered = renderTemplate(
      'github/workflows/06-nightly-lite.yml.ejs',
      makeConfig('/tmp/test', {
        collaborationMode: 'trunk-solo',
        governanceLevel: 'L2',
      }) as unknown as Record<string, unknown>,
    )
    expect(rendered).not.toMatch(/check-solo-reactivation/i)
  })

  it('trunk-solo+L3: no EJS tag leaks', () => {
    const rendered = renderTemplate(
      'github/workflows/06-nightly-lite.yml.ejs',
      makeConfig('/tmp/test', {
        collaborationMode: 'trunk-solo',
        governanceLevel: 'L3',
      }) as unknown as Record<string, unknown>,
    )
    expect(rendered).not.toContain('<%')
    expect(rendered).not.toContain('%>')
  })
})
