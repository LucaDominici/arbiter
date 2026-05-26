import { describe, it, expect } from 'vitest'
import {
  buildRegistry,
  runGeneratorsFromRegistry,
  runGeneratorsSelective,
} from '../../src/generators/registry.js'
import type { GeneratorSpec } from '../../src/generators/registry.js'
import { makeConfig } from '../helpers.js'

describe('buildRegistry — gemini/windsurf/aider wired (#295)', () => {
  it('gemini spec is enabled when tools includes gemini', () => {
    const specs = buildRegistry(makeConfig('/tmp', { tools: ['gemini'] }))
    const spec = specs.find((s) => s.key === 'gemini')
    expect(spec).toBeDefined()
    expect(spec?.enabled).toBe(true)
  })

  it('gemini spec is disabled when tools does not include gemini', () => {
    const specs = buildRegistry(makeConfig('/tmp', { tools: ['claude'] }))
    const spec = specs.find((s) => s.key === 'gemini')
    expect(spec).toBeDefined()
    expect(spec?.enabled).toBe(false)
  })

  it('windsurf spec is enabled when tools includes windsurf', () => {
    const specs = buildRegistry(makeConfig('/tmp', { tools: ['windsurf'] }))
    const spec = specs.find((s) => s.key === 'windsurf')
    expect(spec).toBeDefined()
    expect(spec?.enabled).toBe(true)
  })

  it('windsurf spec is disabled when tools does not include windsurf', () => {
    const specs = buildRegistry(makeConfig('/tmp', { tools: ['claude'] }))
    const spec = specs.find((s) => s.key === 'windsurf')
    expect(spec).toBeDefined()
    expect(spec?.enabled).toBe(false)
  })

  it('aider spec is enabled when tools includes aider', () => {
    const specs = buildRegistry(makeConfig('/tmp', { tools: ['aider'] }))
    const spec = specs.find((s) => s.key === 'aider')
    expect(spec).toBeDefined()
    expect(spec?.enabled).toBe(true)
  })

  it('aider spec is disabled when tools does not include aider', () => {
    const specs = buildRegistry(makeConfig('/tmp', { tools: ['claude'] }))
    const spec = specs.find((s) => s.key === 'aider')
    expect(spec).toBeDefined()
    expect(spec?.enabled).toBe(false)
  })

  it('all three disabled when aiRulez is already managed', () => {
    const specs = buildRegistry(
      makeConfig('/tmp', {
        tools: ['gemini', 'windsurf', 'aider'],
        existing: {
          agentsMd: false,
          claudeDir: false,
          agentsDir: false,
          aiRulez: true,
          settingsJson: false,
          checkAllScript: false,
          geminiDir: false,
          windsurfRules: false,
          aiderConf: false,
        },
      }),
    )
    expect(specs.find((s) => s.key === 'gemini')?.enabled).toBe(false)
    expect(specs.find((s) => s.key === 'windsurf')?.enabled).toBe(false)
    expect(specs.find((s) => s.key === 'aider')?.enabled).toBe(false)
  })
})

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
    const results = runGeneratorsFromRegistry(specs, [], { dryRun: false })
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
    const results = runGeneratorsFromRegistry(specs, [], { dryRun: false })
    expect(results).toHaveLength(1)
    expect(results[0].path).toBe('/ok')
  })
})

describe('runGeneratorsFromRegistry — error collection (#483)', () => {
  it('caught generator failures populate the optional errors sink', () => {
    const specs: GeneratorSpec[] = [
      {
        key: 'github',
        enabled: true,
        run: () => {
          throw new Error('github boom')
        },
      },
      {
        key: 'root',
        enabled: true,
        run: () => [{ path: '/ok', content: 'ok', action: 'created' }],
      },
    ]
    const errors: { key: string; message: string }[] = []
    const results = runGeneratorsFromRegistry(specs, errors, { dryRun: false })
    expect(results).toHaveLength(1)
    expect(errors).toHaveLength(1)
    expect(errors[0].key).toBe('github')
    expect(errors[0].message).toContain('github boom')
  })

  it('errors sink is empty when all generators succeed', () => {
    const specs: GeneratorSpec[] = [
      {
        key: 'check-all',
        enabled: true,
        run: () => [{ path: '/a', content: 'a', action: 'created' }],
      },
      {
        key: 'root',
        enabled: true,
        run: () => [{ path: '/b', content: 'b', action: 'created' }],
      },
    ]
    const errors: { key: string; message: string }[] = []
    runGeneratorsFromRegistry(specs, errors, { dryRun: false })
    expect(errors).toHaveLength(0)
  })

  it('errors sink is empty when no error occurs (explicit opts)', () => {
    const specs: GeneratorSpec[] = [
      {
        key: 'github',
        enabled: true,
        run: () => {
          throw new Error('boom')
        },
      },
    ]
    const errors: { key: string; message: string }[] = []
    expect(() => runGeneratorsFromRegistry(specs, errors, { dryRun: false })).not.toThrow()
    expect(errors).toHaveLength(1)
  })
})

describe('runGeneratorsSelective — error collection (#483)', () => {
  it('selective run collects errors from selected failing generator', () => {
    const specs: GeneratorSpec[] = [
      {
        key: 'github',
        enabled: true,
        run: () => {
          throw new Error('selective boom')
        },
      },
      {
        key: 'root',
        enabled: true,
        run: () => [{ path: '/ok', content: 'ok', action: 'created' }],
      },
    ]
    const errors: { key: string; message: string }[] = []
    runGeneratorsSelective(specs, new Set(['github', 'root']), errors, { dryRun: false })
    expect(errors).toHaveLength(1)
    expect(errors[0].key).toBe('github')
    expect(errors[0].message).toContain('selective boom')
  })

  it('wildcard selective run propagates errors sink', () => {
    const specs: GeneratorSpec[] = [
      {
        key: 'check-all',
        enabled: true,
        run: () => {
          throw new Error('wildcard boom')
        },
      },
      {
        key: 'root',
        enabled: true,
        run: () => [{ path: '/ok', content: 'ok', action: 'created' }],
      },
    ]
    const errors: { key: string; message: string }[] = []
    runGeneratorsSelective(specs, new Set(['*']), errors, { dryRun: false })
    expect(errors).toHaveLength(1)
    expect(errors[0].key).toBe('check-all')
  })
})

describe('runGeneratorsSelective', () => {
  it('selected generator failure does not abort other selected generators (#303)', () => {
    const specs: GeneratorSpec[] = [
      {
        key: 'check-all',
        enabled: true,
        run: () => [{ path: '/check', content: 'ok', action: 'created' }],
      },
      {
        key: 'github',
        enabled: true,
        run: () => {
          throw new Error('github boom')
        },
      },
      {
        key: 'root',
        enabled: true,
        run: () => [{ path: '/root', content: 'ok', action: 'created' }],
      },
    ]
    const results = runGeneratorsSelective(specs, new Set(['check-all', 'github', 'root']), [], {
      dryRun: false,
    })
    expect(results).toHaveLength(2)
    expect(results.map((r) => r.path)).toContain('/check')
    expect(results.map((r) => r.path)).toContain('/root')
  })

  it('wildcard selective run uses same isolation as full run (#303)', () => {
    const specs: GeneratorSpec[] = [
      {
        key: 'check-all',
        enabled: true,
        run: () => {
          throw new Error('boom')
        },
      },
      {
        key: 'root',
        enabled: true,
        run: () => [{ path: '/root', content: 'ok', action: 'created' }],
      },
    ]
    const results = runGeneratorsSelective(specs, new Set(['*']), [], { dryRun: false })
    expect(results).toHaveLength(1)
    expect(results[0].path).toBe('/root')
  })
})
