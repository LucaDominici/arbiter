import { describe, it, expect } from 'vitest'
import { makeConfig, renderCheckAll } from '../helpers.js'

describe('check-all.mjs.ejs inlines workflow-runners logic (#191, #247)', () => {
  it('rendered check-all.mjs contains CI_BUILD_RUNNER_LABEL pattern guard', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      governanceLevel: 'L1',
    }) as unknown as Record<string, unknown>
    const content = renderCheckAll(data)
    expect(content).toContain('CI_BUILD_RUNNER_LABEL')
    expect(content).toContain('runs-on')
    expect(content).toContain('_wrViolations')
  })

  it('rendered check-all.mjs contains readdirSync import for inline workflow scan', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      governanceLevel: 'L1',
    }) as unknown as Record<string, unknown>
    const content = renderCheckAll(data)
    expect(content).toContain('readdirSync')
    expect(content).toContain('node:fs')
  })
})

describe('check-all.mjs.ejs inlines ci-alignment logic (#240, #247)', () => {
  it('rendered check-all.mjs contains _caDesignExemptions and _caExtractManifestGates', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      governanceLevel: 'L1',
    }) as unknown as Record<string, unknown>
    const content = renderCheckAll(data)
    expect(content).toContain('_caDesignExemptions')
    expect(content).toContain('_caExtractManifestGates')
    expect(content).toContain('_caExtractCiGates')
  })

  it('ci-alignment inline block does NOT include gitleaks case (enableSecurityScanning=false)', () => {
    const data = makeConfig('/tmp/test', {
      language: 'typescript',
      enableSecurityScanning: false,
      governanceLevel: 'L1',
    }) as unknown as Record<string, unknown>
    const content = renderCheckAll(data)
    expect(content).not.toContain('gitleaks')
  })
})
