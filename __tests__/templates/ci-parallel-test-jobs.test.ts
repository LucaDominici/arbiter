import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

describe('ci.yml.ejs — parallel test category jobs (#219)', () => {
  describe('TypeScript L2', () => {
    it('has unit-tests job', () => {
      const data = makeConfig('/tmp/test', {
        language: 'typescript',
        governanceLevel: 'L2',
      }) as unknown as Record<string, unknown>
      const rendered = renderTemplate('github/workflows/ci.yml.ejs', data)
      expect(rendered).toContain('unit-tests:')
    })

    it('has contract-tests job', () => {
      const data = makeConfig('/tmp/test', {
        language: 'typescript',
        governanceLevel: 'L2',
      }) as unknown as Record<string, unknown>
      const rendered = renderTemplate('github/workflows/ci.yml.ejs', data)
      expect(rendered).toContain('contract-tests:')
    })

    it('has integration-tests job with needs: [unit-tests]', () => {
      const data = makeConfig('/tmp/test', {
        language: 'typescript',
        governanceLevel: 'L2',
      }) as unknown as Record<string, unknown>
      const rendered = renderTemplate('github/workflows/ci.yml.ejs', data)
      expect(rendered).toContain('integration-tests:')
      const integSection = rendered.split('integration-tests:')[1]
      expect(integSection).toMatch(/needs:.*unit-tests/)
    })

    it('has behavioral-tests job with needs: [unit-tests]', () => {
      const data = makeConfig('/tmp/test', {
        language: 'typescript',
        governanceLevel: 'L2',
      }) as unknown as Record<string, unknown>
      const rendered = renderTemplate('github/workflows/ci.yml.ejs', data)
      expect(rendered).toContain('behavioral-tests:')
      const behavSection = rendered.split('behavioral-tests:')[1]
      expect(behavSection).toMatch(/needs:.*unit-tests/)
    })

    it('ci-required needs includes unit-tests, contract-tests, integration-tests, behavioral-tests', () => {
      const data = makeConfig('/tmp/test', {
        language: 'typescript',
        governanceLevel: 'L2',
      }) as unknown as Record<string, unknown>
      const rendered = renderTemplate('github/workflows/ci.yml.ejs', data)
      const ciRequired = rendered.split('ci-required:')[1]
      expect(ciRequired).toContain('unit-tests')
      expect(ciRequired).toContain('contract-tests')
      expect(ciRequired).toContain('integration-tests')
      expect(ciRequired).toContain('behavioral-tests')
    })

    it('uses npm run test:unit in unit-tests job', () => {
      const data = makeConfig('/tmp/test', {
        language: 'typescript',
        governanceLevel: 'L2',
      }) as unknown as Record<string, unknown>
      const rendered = renderTemplate('github/workflows/ci.yml.ejs', data)
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
      const rendered = renderTemplate('github/workflows/ci.yml.ejs', data)
      const ciRequired = rendered.split('ci-required:')[1]
      expect(ciRequired).not.toContain('unit-tests')
      expect(ciRequired).not.toContain('contract-tests')
      expect(ciRequired).not.toContain('integration-tests')
      expect(ciRequired).not.toContain('behavioral-tests')
    })

    it('Rust ci-required only needs lint-and-test', () => {
      const data = makeConfig('/tmp/test', {
        language: 'rust',
        buildTool: 'cargo',
        governanceLevel: 'L1',
      }) as unknown as Record<string, unknown>
      const rendered = renderTemplate('github/workflows/ci.yml.ejs', data)
      const ciRequired = rendered.split('ci-required:')[1]
      expect(ciRequired).toContain('lint-and-test')
    })
  })

  describe('Java L2 (Maven)', () => {
    it('has unit-tests job', () => {
      const data = makeConfig('/tmp/test', {
        language: 'java',
        buildTool: 'maven',
        governanceLevel: 'L2',
      }) as unknown as Record<string, unknown>
      const rendered = renderTemplate('github/workflows/ci.yml.ejs', data)
      expect(rendered).toContain('unit-tests:')
    })

    it('has contract-tests job', () => {
      const data = makeConfig('/tmp/test', {
        language: 'java',
        buildTool: 'maven',
        governanceLevel: 'L2',
      }) as unknown as Record<string, unknown>
      const rendered = renderTemplate('github/workflows/ci.yml.ejs', data)
      expect(rendered).toContain('contract-tests:')
    })

    it('has integration-tests job', () => {
      const data = makeConfig('/tmp/test', {
        language: 'java',
        buildTool: 'maven',
        governanceLevel: 'L2',
      }) as unknown as Record<string, unknown>
      const rendered = renderTemplate('github/workflows/ci.yml.ejs', data)
      expect(rendered).toContain('integration-tests:')
    })

    it('ci-required includes all test jobs', () => {
      const data = makeConfig('/tmp/test', {
        language: 'java',
        buildTool: 'maven',
        governanceLevel: 'L2',
      }) as unknown as Record<string, unknown>
      const rendered = renderTemplate('github/workflows/ci.yml.ejs', data)
      const ciRequired = rendered.split('ci-required:')[1]
      expect(ciRequired).toContain('unit-tests')
      expect(ciRequired).toContain('integration-tests')
    })
  })
})
