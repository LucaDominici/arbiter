import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

describe('01-pr-fast.yml.ejs — parallel test category jobs (#219)', () => {
  describe('TypeScript L2', () => {
    it('has unit-tests job', () => {
      const data = makeConfig('/tmp/test', {
        language: 'typescript',
        governanceLevel: 'L2',
      }) as unknown as Record<string, unknown>
      const rendered = renderTemplate('github/workflows/01-pr-fast.yml.ejs', data)
      expect(rendered).toContain('unit-tests:')
    })

    // #1875: contract-tests/integration-tests/behavioral-tests moved OFF the
    // always-run T1 lane to 02-pr-extended.yml.ejs (T2) — they used to fan out
    // from `gate` unconditionally, blowing the ADR-090 15min T1 budget (measured
    // ~12min for contract-tests alone on arbiter's own dogfooded CI).
    it('does NOT have contract-tests/integration-tests/behavioral-tests jobs (moved to T2)', () => {
      const data = makeConfig('/tmp/test', {
        language: 'typescript',
        governanceLevel: 'L2',
      }) as unknown as Record<string, unknown>
      const rendered = renderTemplate('github/workflows/01-pr-fast.yml.ejs', data)
      expect(rendered).not.toContain('contract-tests:')
      expect(rendered).not.toContain('integration-tests:')
      expect(rendered).not.toContain('behavioral-tests:')
    })

    it('ci-required needs includes unit-tests, not contract/integration/behavioral-tests', () => {
      const data = makeConfig('/tmp/test', {
        language: 'typescript',
        governanceLevel: 'L2',
      }) as unknown as Record<string, unknown>
      const rendered = renderTemplate('github/workflows/01-pr-fast.yml.ejs', data)
      const ciRequired = rendered.split('ci-required:')[1]
      expect(ciRequired).toContain('unit-tests')
      expect(ciRequired).not.toContain('contract-tests')
      expect(ciRequired).not.toContain('integration-tests')
      expect(ciRequired).not.toContain('behavioral-tests')
    })

    it('uses npm run test:unit in unit-tests job', () => {
      const data = makeConfig('/tmp/test', {
        language: 'typescript',
        governanceLevel: 'L2',
      }) as unknown as Record<string, unknown>
      const rendered = renderTemplate('github/workflows/01-pr-fast.yml.ejs', data)
      expect(rendered).toContain('test:unit')
    })
  })

  describe('Rust L2 — ci-required must NOT reference unit-tests', () => {
    it('ci-required does not include unit-tests/contract-tests for Rust', () => {
      const data = makeConfig('/tmp/test', {
        language: 'rust',
        buildTool: 'cargo',
        governanceLevel: 'L2',
      }) as unknown as Record<string, unknown>
      const rendered = renderTemplate('github/workflows/01-pr-fast.yml.ejs', data)
      const ciRequired = rendered.split('ci-required:')[1]
      expect(ciRequired).not.toContain('unit-tests')
      expect(ciRequired).not.toContain('contract-tests')
      expect(ciRequired).not.toContain('integration-tests')
      expect(ciRequired).not.toContain('behavioral-tests')
    })

    it('Rust ci-required only needs gate', () => {
      const data = makeConfig('/tmp/test', {
        language: 'rust',
        buildTool: 'cargo',
        governanceLevel: 'L1',
      }) as unknown as Record<string, unknown>
      const rendered = renderTemplate('github/workflows/01-pr-fast.yml.ejs', data)
      const ciRequired = rendered.split('ci-required:')[1]
      expect(ciRequired).toContain('gate')
    })
  })

  describe('Java L2 (Maven)', () => {
    it('has unit-tests job', () => {
      const data = makeConfig('/tmp/test', {
        language: 'java',
        buildTool: 'maven',
        governanceLevel: 'L2',
      }) as unknown as Record<string, unknown>
      const rendered = renderTemplate('github/workflows/01-pr-fast.yml.ejs', data)
      expect(rendered).toContain('unit-tests:')
    })

    // #1875: same T1 → T2 move as TypeScript above, mirrored for the Java/Maven
    // surefire-profile variant (contract/integration/behavioral).
    it('does NOT have contract-tests/integration-tests/behavioral-tests jobs (moved to T2)', () => {
      const data = makeConfig('/tmp/test', {
        language: 'java',
        buildTool: 'maven',
        governanceLevel: 'L2',
      }) as unknown as Record<string, unknown>
      const rendered = renderTemplate('github/workflows/01-pr-fast.yml.ejs', data)
      expect(rendered).not.toContain('contract-tests:')
      expect(rendered).not.toContain('integration-tests:')
      expect(rendered).not.toContain('behavioral-tests:')
    })

    it('ci-required includes unit-tests but not integration-tests', () => {
      const data = makeConfig('/tmp/test', {
        language: 'java',
        buildTool: 'maven',
        governanceLevel: 'L2',
      }) as unknown as Record<string, unknown>
      const rendered = renderTemplate('github/workflows/01-pr-fast.yml.ejs', data)
      const ciRequired = rendered.split('ci-required:')[1]
      expect(ciRequired).toContain('unit-tests')
      expect(ciRequired).not.toContain('integration-tests')
    })
  })
})

// #1875: contract-tests/integration-tests/behavioral-tests now live on the
// conditionally-triggered T2 lane (check-trigger), not on always-run T1.
describe('02-pr-extended.yml.ejs — parallel test category jobs (#1875)', () => {
  it.each([
    { language: 'typescript', buildTool: 'npm' },
    { language: 'java', buildTool: 'maven' },
  ] as const)(
    '$language: has contract-tests job gated on check-trigger',
    ({ language, buildTool }) => {
      const data = makeConfig('/tmp/test', {
        language,
        buildTool,
        governanceLevel: 'L2',
      }) as unknown as Record<string, unknown>
      const rendered = renderTemplate('github/workflows/02-pr-extended.yml.ejs', data)
      expect(rendered).toContain('contract-tests:')
      const section = rendered.split('contract-tests:')[1]
      expect(section).toContain("needs.check-trigger.outputs.should_run == 'true'")
    },
  )

  it.each(['go', 'python', 'rust'] as const)(
    '%s: does NOT have a contract-tests job (T1 never had one for this language)',
    (language) => {
      const buildTool = language === 'python' ? 'pip' : language
      const data = makeConfig('/tmp/test', {
        language,
        buildTool,
        governanceLevel: 'L2',
      }) as unknown as Record<string, unknown>
      const rendered = renderTemplate('github/workflows/02-pr-extended.yml.ejs', data)
      expect(rendered).not.toContain('contract-tests:')
    },
  )

  it('TypeScript: extended-required aggregator includes contract-tests', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      governanceLevel: 'L2',
    }) as unknown as Record<string, unknown>
    const rendered = renderTemplate('github/workflows/02-pr-extended.yml.ejs', data)
    const aggregator = rendered.split('extended-required:')[1] ?? ''
    expect(aggregator).toContain('contract-tests')
    expect(aggregator).toContain('needs.contract-tests.result')
  })
})
