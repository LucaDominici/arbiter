// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function makeData(overrides: Record<string, unknown> = {}) {
  return makeConfig(
    '/tmp/test',
    overrides as Parameters<typeof makeConfig>[1],
  ) as unknown as Record<string, unknown>
}

// ─── check-suppression-rationale.mjs.ejs ─────────────────────────────────────

describe('check-suppression-rationale.mjs.ejs rendering (CANON-04, INV-89)', () => {
  it('renders shebang and INV-89 citation', () => {
    const content = renderTemplate('scripts/check-suppression-rationale.mjs.ejs', makeData())
    expect(content).toMatch(/^#!/)
    expect(content).toContain('INV-89')
  })

  it('renders SKIP path for missing suppressions/ directory', () => {
    const content = renderTemplate('scripts/check-suppression-rationale.mjs.ejs', makeData())
    expect(content).toContain('SKIP')
    expect(content).toContain('suppressions/')
  })

  it('renders --help flag support', () => {
    const content = renderTemplate('scripts/check-suppression-rationale.mjs.ejs', makeData())
    expect(content).toContain('--help')
    expect(content).toContain('--help, -h')
  })

  it.each(['L1', 'L2', 'L3'] as const)('governance %s: no EJS tag leaks', (level) => {
    const content = renderTemplate(
      'scripts/check-suppression-rationale.mjs.ejs',
      makeData({ governanceLevel: level }),
    )
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
  })
})

// ─── check-suppression-expiry.mjs.ejs ────────────────────────────────────────

describe('check-suppression-expiry.mjs.ejs rendering (CANON-04, INV-89)', () => {
  it('renders shebang and INV-89 citation', () => {
    const content = renderTemplate('scripts/check-suppression-expiry.mjs.ejs', makeData())
    expect(content).toMatch(/^#!/)
    expect(content).toContain('INV-89')
  })

  it('renders --max-days option support', () => {
    const content = renderTemplate('scripts/check-suppression-expiry.mjs.ejs', makeData())
    expect(content).toContain('--max-days')
    expect(content).toContain('365')
  })

  it.each(['L1', 'L2', 'L3'] as const)('governance %s: no EJS tag leaks', (level) => {
    const content = renderTemplate(
      'scripts/check-suppression-expiry.mjs.ejs',
      makeData({ governanceLevel: level }),
    )
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
  })
})

// ─── check-pii-scan.mjs.ejs ──────────────────────────────────────────────────

describe('check-pii-scan.mjs.ejs rendering (CANON-04, INV-89)', () => {
  it('renders shebang and INV-89 citation', () => {
    const content = renderTemplate('scripts/check-pii-scan.mjs.ejs', makeData())
    expect(content).toMatch(/^#!/)
    expect(content).toContain('INV-89')
  })

  it('renders pii-patterns.txt reference', () => {
    const content = renderTemplate('scripts/check-pii-scan.mjs.ejs', makeData())
    expect(content).toContain('pii-patterns.txt')
  })

  it('renders --patterns option', () => {
    const content = renderTemplate('scripts/check-pii-scan.mjs.ejs', makeData())
    expect(content).toContain('--patterns')
  })

  it.each(['L1', 'L2', 'L3'] as const)('governance %s: no EJS tag leaks', (level) => {
    const content = renderTemplate(
      'scripts/check-pii-scan.mjs.ejs',
      makeData({ governanceLevel: level }),
    )
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
  })
})

// ─── check-secret-scan.mjs.ejs ───────────────────────────────────────────────

describe('check-secret-scan.mjs.ejs rendering (CANON-04, INV-89)', () => {
  it('renders shebang and INV-89 citation', () => {
    const content = renderTemplate('scripts/check-secret-scan.mjs.ejs', makeData())
    expect(content).toMatch(/^#!/)
    expect(content).toContain('INV-89')
  })

  it('renders AWS and GitHub token patterns', () => {
    const content = renderTemplate('scripts/check-secret-scan.mjs.ejs', makeData())
    expect(content).toContain('AKIA')
    expect(content).toContain('ghp_')
  })

  it('skips test files and fixtures', () => {
    const content = renderTemplate('scripts/check-secret-scan.mjs.ejs', makeData())
    expect(content).toContain('__tests__/')
    expect(content).toContain('/fixtures/')
  })

  it.each(['L1', 'L2', 'L3'] as const)('governance %s: no EJS tag leaks', (level) => {
    const content = renderTemplate(
      'scripts/check-secret-scan.mjs.ejs',
      makeData({ governanceLevel: level }),
    )
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
  })
})

// ─── check-drift.mjs.ejs ─────────────────────────────────────────────────────

describe('check-drift.mjs.ejs rendering (CANON-04, INV-89)', () => {
  it('renders shebang and INV-89 citation', () => {
    const content = renderTemplate('scripts/check-drift.mjs.ejs', makeData())
    expect(content).toMatch(/^#!/)
    expect(content).toContain('INV-89')
  })

  it('renders SKIP path for missing drift manifest', () => {
    const content = renderTemplate('scripts/check-drift.mjs.ejs', makeData())
    expect(content).toContain('SKIP')
    expect(content).toContain('drift-manifest.json')
  })

  it('renders sha256 hash verification', () => {
    const content = renderTemplate('scripts/check-drift.mjs.ejs', makeData())
    expect(content).toContain('sha256')
    expect(content).toContain('createHash')
  })

  it.each(['L1', 'L2', 'L3'] as const)('governance %s: no EJS tag leaks', (level) => {
    const content = renderTemplate(
      'scripts/check-drift.mjs.ejs',
      makeData({ governanceLevel: level }),
    )
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
  })
})

// ─── check-workflow-sha-pinning.mjs.ejs ──────────────────────────────────────

describe('check-workflow-sha-pinning.mjs.ejs rendering (CANON-04, INV-89)', () => {
  it('renders shebang and INV-89 citation', () => {
    const content = renderTemplate('scripts/check-workflow-sha-pinning.mjs.ejs', makeData())
    expect(content).toMatch(/^#!/)
    expect(content).toContain('INV-89')
  })

  it('renders SHA pattern for 40-char hex detection', () => {
    const content = renderTemplate('scripts/check-workflow-sha-pinning.mjs.ejs', makeData())
    expect(content).toContain('[0-9a-f]{40}')
  })

  it('skips local composite actions starting with dot', () => {
    const content = renderTemplate('scripts/check-workflow-sha-pinning.mjs.ejs', makeData())
    expect(content).toContain("startsWith('.')")
  })

  it.each(['L1', 'L2', 'L3'] as const)('governance %s: no EJS tag leaks', (level) => {
    const content = renderTemplate(
      'scripts/check-workflow-sha-pinning.mjs.ejs',
      makeData({ governanceLevel: level }),
    )
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
  })
})

// ─── check-workflow-job-naming.mjs.ejs ───────────────────────────────────────

describe('check-workflow-job-naming.mjs.ejs rendering (CANON-04, INV-89)', () => {
  it('renders shebang and INV-89 citation', () => {
    const content = renderTemplate('scripts/check-workflow-job-naming.mjs.ejs', makeData())
    expect(content).toMatch(/^#!/)
    expect(content).toContain('INV-89')
  })

  it('renders name: field check for jobs', () => {
    const content = renderTemplate('scripts/check-workflow-job-naming.mjs.ejs', makeData())
    expect(content).toContain('has no name: field')
  })

  it.each(['L1', 'L2', 'L3'] as const)('governance %s: no EJS tag leaks', (level) => {
    const content = renderTemplate(
      'scripts/check-workflow-job-naming.mjs.ejs',
      makeData({ governanceLevel: level }),
    )
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
  })
})

// ─── check-workflow-test-integrity.mjs.ejs ───────────────────────────────────

describe('check-workflow-test-integrity.mjs.ejs rendering (CANON-04, INV-89)', () => {
  it('renders on: and jobs: section checks', () => {
    const content = renderTemplate('scripts/check-workflow-test-integrity.mjs.ejs', makeData())
    expect(content).toContain("on:'")
    expect(content).toContain("jobs:'")
  })

  it('renders continue-on-error guard (INV-80)', () => {
    const content = renderTemplate('scripts/check-workflow-test-integrity.mjs.ejs', makeData())
    expect(content).toContain('continue-on-error')
    expect(content).toContain('INV-80')
  })

  it.each(['L1', 'L2', 'L3'] as const)('governance %s: no EJS tag leaks', (level) => {
    const content = renderTemplate(
      'scripts/check-workflow-test-integrity.mjs.ejs',
      makeData({ governanceLevel: level }),
    )
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
  })
})
