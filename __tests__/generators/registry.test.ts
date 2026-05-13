import { describe, it, expect } from 'vitest'
import { buildRegistry, runGeneratorsFromRegistry } from '../../src/generators/registry.js'
import type { GeneratorSpec } from '../../src/generators/registry.js'
import { makeConfig } from '../helpers.js'

describe('buildRegistry', () => {
  it('check-all is always enabled regardless of useGitHub', () => {
    const withGitHub = buildRegistry(makeConfig('/tmp', { useGitHub: true }))
    const withoutGitHub = buildRegistry(makeConfig('/tmp', { useGitHub: false }))

    const find = (specs: ReturnType<typeof buildRegistry>, key: string) =>
      specs.find((s) => s.key === key)

    expect(find(withGitHub, 'check-all')?.enabled).toBe(true)
    expect(find(withoutGitHub, 'check-all')?.enabled).toBe(true)
  })

  it('github generator is only enabled when useGitHub is true', () => {
    const withGitHub = buildRegistry(makeConfig('/tmp', { useGitHub: true }))
    const withoutGitHub = buildRegistry(makeConfig('/tmp', { useGitHub: false }))

    const find = (specs: ReturnType<typeof buildRegistry>, key: string) =>
      specs.find((s) => s.key === key)

    expect(find(withGitHub, 'github')?.enabled).toBe(true)
    expect(find(withoutGitHub, 'github')?.enabled).toBe(false)
  })

  it('suppressions is always enabled regardless of enableSuppressions (#242)', () => {
    const withSuppression = buildRegistry(makeConfig('/tmp', { enableSuppressions: true }))
    const withoutSuppression = buildRegistry(makeConfig('/tmp', { enableSuppressions: false }))

    const find = (specs: ReturnType<typeof buildRegistry>, key: string) =>
      specs.find((s) => s.key === key)

    expect(find(withSuppression, 'suppressions')?.enabled).toBe(true)
    expect(find(withoutSuppression, 'suppressions')?.enabled).toBe(true)
  })

  it('integration-testing is gated on hasDatabase not enableContractTesting (INV-34, #282)', () => {
    const find = (specs: ReturnType<typeof buildRegistry>, key: string) =>
      specs.find((s) => s.key === key)

    expect(
      find(buildRegistry(makeConfig('/tmp', { hasDatabase: true })), 'integration-testing')
        ?.enabled,
    ).toBe(true)
    expect(
      find(buildRegistry(makeConfig('/tmp', { hasDatabase: false })), 'integration-testing')
        ?.enabled,
    ).toBe(false)
  })

  it('integration-testing enabled when hasDatabase=true even if enableContractTesting=false (#282)', () => {
    const specs = buildRegistry(
      makeConfig('/tmp', { hasDatabase: true, enableContractTesting: false }),
    )
    const spec = specs.find((s) => s.key === 'integration-testing')
    expect(spec?.enabled).toBe(true)
  })
})

describe('runGeneratorsFromRegistry', () => {
  it('isolates generator failures — one throw does not abort others (#303)', () => {
    const specs: GeneratorSpec[] = [
      {
        key: 'check-all',
        enabled: true,
        run: () => [{ path: '/ok', content: 'ok', action: 'created' }],
      },
      {
        key: 'github',
        enabled: true,
        run: () => {
          throw new Error('generator boom')
        },
      },
      {
        key: 'root',
        enabled: true,
        run: () => [{ path: '/also-ok', content: 'ok2', action: 'created' }],
      },
    ]
    const results = runGeneratorsFromRegistry(specs)
    expect(results).toHaveLength(2)
    expect(results.map((r) => r.path)).toContain('/ok')
    expect(results.map((r) => r.path)).toContain('/also-ok')
  })

  it('disabled specs are skipped even if adjacent spec throws (#303)', () => {
    const specs: GeneratorSpec[] = [
      {
        key: 'check-all',
        enabled: false,
        run: () => [{ path: '/skip', content: 'x', action: 'created' }],
      },
      {
        key: 'github',
        enabled: true,
        run: () => {
          throw new Error('boom')
        },
      },
      { key: 'root', enabled: true, run: () => [{ path: '/ok', content: 'y', action: 'created' }] },
    ]
    const results = runGeneratorsFromRegistry(specs)
    expect(results).toHaveLength(1)
    expect(results[0].path).toBe('/ok')
  })
})
